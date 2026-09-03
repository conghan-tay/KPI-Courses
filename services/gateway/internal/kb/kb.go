// Package kb holds the rules of Journey 1: what a draft looks like before the pipeline
// has run, what a stranger is allowed to see, and what must be true before a knowledge
// base can go live.
//
// Everything in this file is a pure function of its arguments. That is the point: these
// rules used to live in the web app's route handlers, where testing them meant standing
// up Next, and they are the rules Journeys 2 and 3 inherit.
package kb

import (
	"fmt"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"github.com/example/reverse-interview/services/gateway/internal/api"
)

// NewDraft builds the row that is written *before* the pipeline is started.
//
// That ordering is the whole of "ingestion timeout → keep the draft, offer retry": a
// knowledge base in ingest_status "running" is one that exists and has no sections yet,
// and a failure leaves something to retry instead of a lost upload.
func NewDraft(
	id string, user api.User, request api.IngestRequest, now string,
) api.KnowledgeBase {
	knowledgeBase := api.KnowledgeBase{
		ID:            id,
		CandidateID:   user.ID,
		CandidateName: user.Name,
		CandidateBio:  user.Bio,
		Slug:          Slugify(request.Title),
		Title:         strings.TrimSpace(request.Title),
		Tagline:       strings.TrimSpace(request.Tagline),
		Status:        api.StatusDraft,
		IngestStatus:  api.IngestRunning,
		SourceText:    request.SourceText,
		SourceFiles:   request.SourceFiles,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	knowledgeBase.Normalize()
	return knowledgeBase
}

// ApplyIngestResult folds the pipeline's output into a draft.
//
// The pipeline may omit ordinals or number them badly; they are ours to assign either
// way, so the incoming order is respected and the numbering is not.
func ApplyIngestResult(
	knowledgeBase api.KnowledgeBase, result api.IngestResult,
) api.KnowledgeBase {
	knowledgeBase.Sections = Renumber(result.Sections)
	knowledgeBase.Chips = result.Chips
	knowledgeBase.Quiz = result.Quiz
	knowledgeBase.PreRoll = result.PreRoll
	knowledgeBase.IngestStatus = api.IngestReady
	knowledgeBase.IngestError = ""
	knowledgeBase.Normalize()
	return knowledgeBase
}

// MarkIngestFailed keeps the draft and records why, which is what the review screen's
// [RETRY INGESTION] state reads.
func MarkIngestFailed(knowledgeBase api.KnowledgeBase, message string) api.KnowledgeBase {
	knowledgeBase.IngestStatus = api.IngestFailed
	knowledgeBase.IngestError = message
	return knowledgeBase
}

// MarkIngestRunning resets a failed draft for a retry.
func MarkIngestRunning(knowledgeBase api.KnowledgeBase) api.KnowledgeBase {
	knowledgeBase.IngestStatus = api.IngestRunning
	knowledgeBase.IngestError = ""
	return knowledgeBase
}

// ApplyPatch applies a partial edit from the review screen. A nil field means "leave
// this alone"; only what the client sent is touched.
func ApplyPatch(knowledgeBase api.KnowledgeBase, patch api.KBPatch) api.KnowledgeBase {
	if patch.Title != nil {
		knowledgeBase.Title = strings.TrimSpace(*patch.Title)
	}
	if patch.Tagline != nil {
		knowledgeBase.Tagline = strings.TrimSpace(*patch.Tagline)
	}
	if patch.Sections != nil {
		knowledgeBase.Sections = Renumber(*patch.Sections)
	}
	if patch.Chips != nil {
		knowledgeBase.Chips = *patch.Chips
	}
	if patch.Quiz != nil {
		knowledgeBase.Quiz = *patch.Quiz
	}
	if patch.PreRoll != nil {
		knowledgeBase.PreRoll = *patch.PreRoll
	}
	knowledgeBase.Normalize()
	return knowledgeBase
}

// Renumber makes `ord` a display ordinal again: 1..n with no gaps, in the order given.
// Reordering on the review screen is a reorder of the slice; the numbers follow.
func Renumber(sections []api.Section) []api.Section {
	out := make([]api.Section, len(sections))
	for index, section := range sections {
		section.Ord = index + 1
		section.Normalize()
		out[index] = section
	}
	return out
}

// UnresolvedChips lists the chips whose section reference names nothing.
//
// A twin of unresolved_indexes in services/agent/app/graph/refs.py and auditRefs in
// services/web/lib/refs.ts. The pipeline clears a reference it cannot resolve, so this
// is normally empty — but the candidate can also delete a section out from under a chip
// on the review screen, and that is exactly when the warning has to appear.
func UnresolvedChips(knowledgeBase api.KnowledgeBase) []int {
	ids := knowledgeBase.SectionIDs()
	unresolved := []int{}
	for index, chip := range knowledgeBase.Chips {
		if !ids[chip.KBSection] {
			unresolved = append(unresolved, index)
		}
	}
	return unresolved
}

// UnresolvedQuiz is the same check over the quiz.
func UnresolvedQuiz(knowledgeBase api.KnowledgeBase) []int {
	ids := knowledgeBase.SectionIDs()
	unresolved := []int{}
	for index, item := range knowledgeBase.Quiz {
		if !ids[item.SourceSection] {
			unresolved = append(unresolved, index)
		}
	}
	return unresolved
}

// PublishBlockers lists what must be fixed before a knowledge base can be made public.
//
// The line between a blocker and a warning is whether the recruiter-facing product is
// *broken* without it. Fewer than eight chips or fewer than twelve quiz items is a
// thinner page, and POC_UserJourney.md is explicit that a candidate with a sparse corpus
// still has something worth publishing — so those warn and never block. A front page
// with two chips on it, or a gate that cannot ask one question per category, is a screen
// that does not work.
func PublishBlockers(knowledgeBase api.KnowledgeBase) []string {
	blockers := []string{}
	if strings.TrimSpace(knowledgeBase.Title) == "" {
		blockers = append(blockers, "Your knowledge base needs a name on it.")
	}
	if strings.TrimSpace(knowledgeBase.Tagline) == "" {
		blockers = append(blockers, "Add the one line under your name — about ten words.")
	}
	if len(knowledgeBase.Sections) == 0 {
		blockers = append(
			blockers, "A knowledge base with no sections has nothing to answer from.",
		)
	}
	if selected := len(knowledgeBase.SelectedChips()); selected != api.SelectedChipCount {
		blockers = append(blockers, fmt.Sprintf(
			"Pick exactly %d opening questions for your front page. %d selected.",
			api.SelectedChipCount, selected,
		))
	}
	// The gate samples one item per category and requires all four correct. A missing
	// category is not a thin quiz — it is a gate that cannot be run.
	if missing := missingQuizCategories(knowledgeBase); len(missing) > 0 {
		blockers = append(blockers, fmt.Sprintf(
			"The booking quiz needs a question in every category. Missing: %s.",
			strings.Join(missing, ", "),
		))
	}
	if knowledgeBase.IngestStatus == api.IngestRunning {
		blockers = append(blockers, "We're still building this. Give it a minute.")
	}
	return blockers
}

// QuizCategories is every category the gate samples from, in the order the review screen
// groups them.
var QuizCategories = []string{
	api.CategoryMotivation,
	api.CategoryJudgement,
	api.CategoryLimits,
	api.CategorySubstance,
}

func missingQuizCategories(knowledgeBase api.KnowledgeBase) []string {
	present := make(map[string]bool, len(QuizCategories))
	for _, item := range knowledgeBase.Quiz {
		present[item.Category] = true
	}
	missing := []string{}
	for _, category := range QuizCategories {
		if !present[category] {
			missing = append(missing, category)
		}
	}
	return missing
}

// ToPublic is the withholding rule, and here it is engineering rather than styling.
//
// Two things are withheld, for two different reasons:
//
//   - The **quiz**, entirely. It gates booking twenty minutes of the candidate's real
//     time, and a leaked `correct_index` turns that gate into a formality. This is a
//     security control, not a conversion mechanic.
//   - `why_it_lands`, section bodies and the source text. Those are the product the hour
//     is sold on, plus the candidate's private notes to themselves about which questions
//     are worth a front page.
//
// It is an allowlist. An omit-list leaks every field anyone adds to KnowledgeBase later
// — including, eventually, the quiz.
func ToPublic(knowledgeBase api.KnowledgeBase) api.PublicKB {
	// Only the selected chips, and only their text. The other five are drafts the
	// candidate chose not to show.
	selected := knowledgeBase.SelectedChips()
	chips := make([]api.PublicChip, len(selected))
	for index, chip := range selected {
		chips[index] = api.PublicChip{Text: chip.Text}
	}
	sections := make([]api.PublicSection, len(knowledgeBase.Sections))
	for index, section := range knowledgeBase.Sections {
		// Titles and summaries say what is loaded, which is what the pre-roll promises.
		// The bodies are the hour.
		sections[index] = api.PublicSection{
			Ord: section.Ord, Title: section.Title, Summary: section.Summary,
		}
	}
	return api.PublicKB{
		ID:            knowledgeBase.ID,
		Slug:          knowledgeBase.Slug,
		Title:         knowledgeBase.Title,
		Tagline:       knowledgeBase.Tagline,
		Status:        knowledgeBase.Status,
		CandidateName: knowledgeBase.CandidateName,
		CandidateBio:  knowledgeBase.CandidateBio,
		PreRoll:       knowledgeBase.PreRoll,
		Chips:         chips,
		Sections:      sections,
	}
}

// ToSummary is the studio list row: no bodies, no chips, no quiz, just counts.
func ToSummary(knowledgeBase api.KnowledgeBase) api.KBSummary {
	return api.KBSummary{
		ID:            knowledgeBase.ID,
		Slug:          knowledgeBase.Slug,
		Title:         knowledgeBase.Title,
		Tagline:       knowledgeBase.Tagline,
		Status:        knowledgeBase.Status,
		IngestStatus:  knowledgeBase.IngestStatus,
		CandidateName: knowledgeBase.CandidateName,
		CreatedAt:     knowledgeBase.CreatedAt,
		UpdatedAt:     knowledgeBase.UpdatedAt,
		SectionCount:  len(knowledgeBase.Sections),
		ChipCount:     len(knowledgeBase.Chips),
		QuizCount:     len(knowledgeBase.Quiz),
	}
}

const maxSlugLength = 60

// Slugify produces the URL-safe slug behind /k/:slug. Collisions are the store's to
// resolve; this only has to be deterministic.
//
// It mirrors slugify in web/lib/text.ts step for step — NFKD, drop combining marks,
// lowercase, collapse everything else to hyphens, trim, truncate, trim again — so a
// knowledge base keeps the same URL whichever side of the wire computed it. "José
// Álvarez" becomes "jose-alvarez" in both, not "jos-lvarez" in one of them.
func Slugify(input string) string {
	decomposed := norm.NFKD.String(input)

	var builder strings.Builder
	previousHyphen := false
	for _, character := range decomposed {
		if unicode.Is(unicode.Mn, character) {
			continue // a combining accent left over from the decomposition
		}
		lowered := unicode.ToLower(character)
		if (lowered >= 'a' && lowered <= 'z') || (lowered >= '0' && lowered <= '9') {
			builder.WriteRune(lowered)
			previousHyphen = false
			continue
		}
		if !previousHyphen {
			builder.WriteByte('-')
			previousHyphen = true
		}
	}

	slug := strings.Trim(builder.String(), "-")
	if len(slug) > maxSlugLength {
		slug = strings.Trim(slug[:maxSlugLength], "-")
	}
	if slug == "" {
		return "candidate"
	}
	return slug
}

// PublicURL is the shareable link the publish dialog copies. The page it points at is
// Journey 2's; the link is minted here because the slug is.
func PublicURL(knowledgeBase api.KnowledgeBase) string {
	return fmt.Sprintf("/k/%s", knowledgeBase.Slug)
}
