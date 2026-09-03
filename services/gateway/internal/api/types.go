// Package api defines the public HTTP contract and the payload shapes exchanged with
// the Temporal workflow.
//
// The JSON tags here are a three-way contract. They mirror the Pydantic models in
// services/agent/app/core/kb_schemas.py, which cross the Temporal boundary, and the
// zod schemas in services/web/lib/types.ts, which the browser parses against. Nothing
// enforces the agreement at build time — a renamed tag surfaces as a workflow task
// failure or a client-side parse error — so keep the three files in step.
package api

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// Knowledge-base lifecycle, matching web/lib/types.ts KBStatusSchema.
const (
	StatusDraft     = "draft"
	StatusPublished = "published"
)

// Ingestion lifecycle. POC_UserJourney.md's data model lists it because the spec
// requires "ingestion timeout → keep the draft, offer retry", and a draft written before
// the model call is the only thing that makes a retry possible.
const (
	IngestRunning = "running"
	IngestReady   = "ready"
	IngestFailed  = "failed"
)

// Roles, matching web/lib/seed.ts.
const (
	RoleCandidate = "candidate"
	RoleRecruiter = "recruiter"
)

// Chip registers, matching app.core.kb_schemas.ChipRegister. chips_example_prompt.txt
// asks for a mix of all three, which is only checkable because the label is stored.
const (
	RegisterSkeptical = "skeptical"
	RegisterNarrative = "narrative"
	RegisterBlunt     = "blunt"
)

// Quiz categories, matching app.core.kb_schemas.QuizCategory. The gate samples one item
// per category, so an item without a category cannot be sampled fairly.
const (
	CategoryMotivation = "motivation"
	CategoryJudgement  = "judgement"
	CategoryLimits     = "limits"
	CategorySubstance  = "substance"
)

// QuizChoiceCount is fixed at four. The gate renders four options and scores one; a
// question carrying three or five is a rendering bug, so it is rejected at the edge.
const QuizChoiceCount = 4

// SelectedChipCount is how many of the generated chips reach the public page. Eight are
// generated, the candidate picks three — chips.json is explicit about both numbers.
const SelectedChipCount = 3

// ValidationError reports a rejected field so the handler can return 400 with a
// message that tells the caller what to fix. Field is dotted for nested values
// ("quiz[2].choices") so a client can put the message next to the input.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("%s %s", e.Field, e.Message)
}

func invalid(field, message string) error {
	return &ValidationError{Field: field, Message: message}
}

// checkLength enforces a rune-count range. Rune counts rather than byte lengths keep
// the limits identical to Pydantic's and zod's, both of which count characters.
func checkLength(field, value string, min, max int) error {
	length := utf8.RuneCountInString(value)
	if length < min {
		if min == 1 {
			return invalid(field, "is required")
		}
		return invalid(field, fmt.Sprintf("must be at least %d characters", min))
	}
	if length > max {
		return invalid(field, fmt.Sprintf("must be at most %d characters", max))
	}
	return nil
}

func checkEnum(field, value string, allowed ...string) error {
	for _, candidate := range allowed {
		if value == candidate {
			return nil
		}
	}
	return invalid(field, "must be one of "+strings.Join(allowed, ", "))
}

// User is a seeded identity. POC_UserJourney.md §0 puts LinkedIn OAuth and the email
// approve/reject loop off until real auth exists and ships a dev-mode role switcher over
// two rows; these are those rows, seeded by migration to match services/web/lib/seed.ts.
type User struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	Bio       string `json:"bio"`
	AvatarURL string `json:"avatar_url,omitempty"`
}

// SectionID is the identifier a chip or a quiz item points at: "path", or "path#anchor".
//
// One function rather than string concatenation at every call site, because reference
// resolution (fixtures/README.md B2) is an equality test on the result and an
// inconsistent join would silently fail all of it. Mirrors section_id() in
// app/core/kb_schemas.py and sectionId() in web/lib/refs.ts.
func SectionID(path, anchor string) string {
	path = strings.Trim(strings.TrimSpace(path), "#/")
	anchor = strings.Trim(strings.TrimSpace(anchor), "#")
	if anchor == "" {
		return path
	}
	return path + "#" + anchor
}

// Section is one addressable piece of the knowledge base — what the candidate publishes
// and what Journey 2's agent will speak from. Ord is a display ordinal, always 1..n with
// no gaps; the server assigns it, whatever order the client sent.
type Section struct {
	Ord         int      `json:"ord"`
	Path        string   `json:"path"`
	Anchor      string   `json:"anchor"`
	Title       string   `json:"title"`
	Summary     string   `json:"summary"`
	BodyMD      string   `json:"body_md"`
	SourceNames []string `json:"source_names"`
}

func (s *Section) Normalize() {
	if s.SourceNames == nil {
		s.SourceNames = []string{}
	}
	s.Path = strings.Trim(strings.TrimSpace(s.Path), "#/")
	s.Anchor = strings.Trim(strings.TrimSpace(s.Anchor), "#")
}

// ID is the reference every chip and quiz item resolves against.
func (s *Section) ID() string { return SectionID(s.Path, s.Anchor) }

func (s *Section) Validate(field string) error {
	if err := checkLength(field+".path", s.Path, 1, 200); err != nil {
		return err
	}
	if err := checkLength(field+".anchor", s.Anchor, 0, 100); err != nil {
		return err
	}
	if err := checkLength(field+".title", s.Title, 1, 300); err != nil {
		return err
	}
	if err := checkLength(field+".summary", s.Summary, 0, 1_000); err != nil {
		return err
	}
	return checkLength(field+".body_md", s.BodyMD, 0, 100_000)
}

// Chip is one opening question a recruiter would type first. Eight are generated and the
// candidate selects three for the public page, which is what Selected records.
//
// KBSection is the hallucination canary: it must resolve to a real section id, it is
// checked in code rather than by asking the model again, and one that cannot be resolved
// is cleared rather than shipped as a fabricated citation.
type Chip struct {
	Text       string `json:"text"`
	KBSection  string `json:"kb_section"`
	Register   string `json:"register"`
	Selected   bool   `json:"selected"`
	WhyItLands string `json:"why_it_lands"`
}

func (c *Chip) Normalize() {
	if c.Register == "" {
		c.Register = RegisterNarrative
	}
}

func (c *Chip) Validate(field string) error {
	if err := checkLength(field+".text", c.Text, 1, 200); err != nil {
		return err
	}
	if err := checkLength(field+".kb_section", c.KBSection, 0, 300); err != nil {
		return err
	}
	if err := checkEnum(
		field+".register", c.Register, RegisterSkeptical, RegisterNarrative, RegisterBlunt,
	); err != nil {
		return err
	}
	return checkLength(field+".why_it_lands", c.WhyItLands, 0, 1_000)
}

// QuizItem is one question from the pool the booking gate samples from.
//
// Rationale is for the candidate reviewing their own quiz. It is never sent to a
// recruiter: the gate says which answers were wrong and never which one was right.
type QuizItem struct {
	ID            string   `json:"id"`
	Category      string   `json:"category"`
	Question      string   `json:"question"`
	Choices       []string `json:"choices"`
	CorrectIndex  int      `json:"correct_index"`
	Rationale     string   `json:"rationale"`
	SourceSection string   `json:"source_section"`
}

func (q *QuizItem) Normalize() {
	if q.Choices == nil {
		q.Choices = []string{}
	}
	if q.Category == "" {
		q.Category = CategorySubstance
	}
}

func (q *QuizItem) Validate(field string) error {
	if err := checkLength(field+".question", q.Question, 1, 500); err != nil {
		return err
	}
	if err := checkEnum(
		field+".category", q.Category,
		CategoryMotivation, CategoryJudgement, CategoryLimits, CategorySubstance,
	); err != nil {
		return err
	}
	if len(q.Choices) != QuizChoiceCount {
		return invalid(
			field+".choices", fmt.Sprintf("must contain exactly %d options", QuizChoiceCount),
		)
	}
	for index, choice := range q.Choices {
		if err := checkLength(
			fmt.Sprintf("%s.choices[%d]", field, index), choice, 1, 500,
		); err != nil {
			return err
		}
	}
	if q.CorrectIndex < 0 || q.CorrectIndex >= QuizChoiceCount {
		return invalid(
			field+".correct_index",
			fmt.Sprintf("must be between 0 and %d", QuizChoiceCount-1),
		)
	}
	if err := checkLength(field+".rationale", q.Rationale, 0, 1_000); err != nil {
		return err
	}
	return checkLength(field+".source_section", q.SourceSection, 0, 300)
}

// PreRoll is what the recruiter reads before the timer starts: one headline and four
// bullets of value proposition, per pre_roll_wireframe.txt. The price line is not here —
// it is platform-fixed copy, not per-candidate data.
type PreRoll struct {
	Headline string   `json:"headline"`
	Bullets  []string `json:"bullets"`
}

// Normalize replaces a nil slice with an empty one. The zod schema defaults it to `[]`,
// and a JSON `null` where the client expects an array is a parse failure on a screen.
func (p *PreRoll) Normalize() {
	if p.Bullets == nil {
		p.Bullets = []string{}
	}
}

// PreRollBullets is the number the wireframe is drawn for. More than this and the card
// stops being a pre-roll and starts being a page.
const PreRollBullets = 4

func (p *PreRoll) Validate(field string) error {
	if err := checkLength(field+".headline", p.Headline, 0, 200); err != nil {
		return err
	}
	if len(p.Bullets) > PreRollBullets {
		return invalid(
			field+".bullets", fmt.Sprintf("must contain at most %d items", PreRollBullets),
		)
	}
	for index, bullet := range p.Bullets {
		if err := checkLength(
			fmt.Sprintf("%s.bullets[%d]", field, index), bullet, 1, 200,
		); err != nil {
			return err
		}
	}
	return nil
}

// KnowledgeBase is the full record, and the payload GET /v1/knowledge-bases/{id} returns
// to its owner. Everything in here except source_text is editable from the review screen.
type KnowledgeBase struct {
	ID            string `json:"id"`
	CandidateID   string `json:"candidate_id"`
	CandidateName string `json:"candidate_name"`
	CandidateBio  string `json:"candidate_bio"`
	Slug          string `json:"slug"`
	// Title is the candidate's display name; Tagline is the one line under it. There is
	// no price: POC_UserJourney.md §0 fixes pricing at the platform level.
	Title        string     `json:"title"`
	Tagline      string     `json:"tagline"`
	Status       string     `json:"status"`
	IngestStatus string     `json:"ingest_status"`
	IngestError  string     `json:"ingest_error,omitempty"`
	PreRoll      PreRoll    `json:"pre_roll"`
	Chips        []Chip     `json:"chips"`
	Quiz         []QuizItem `json:"quiz"`
	Sections     []Section  `json:"sections"`
	// SourceText is the full raw corpus. No RAG: POC_UserJourney.md §0 is explicit that
	// a knowledge base is under 60k tokens and the whole thing goes in the prompt.
	SourceText  string   `json:"source_text"`
	SourceFiles []string `json:"source_files"`
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at"`
}

// Normalize makes every collection non-nil, so the client always gets `[]` not `null`.
func (k *KnowledgeBase) Normalize() {
	if k.Chips == nil {
		k.Chips = []Chip{}
	}
	if k.Quiz == nil {
		k.Quiz = []QuizItem{}
	}
	if k.Sections == nil {
		k.Sections = []Section{}
	}
	if k.SourceFiles == nil {
		k.SourceFiles = []string{}
	}
	k.PreRoll.Normalize()
	for index := range k.Chips {
		k.Chips[index].Normalize()
	}
	for index := range k.Quiz {
		k.Quiz[index].Normalize()
	}
	for index := range k.Sections {
		k.Sections[index].Normalize()
	}
}

// SectionIDs is the set every chip and quiz item is resolved against.
func (k *KnowledgeBase) SectionIDs() map[string]bool {
	ids := make(map[string]bool, len(k.Sections))
	for index := range k.Sections {
		ids[k.Sections[index].ID()] = true
	}
	return ids
}

// SelectedChips is what reaches the public page.
func (k *KnowledgeBase) SelectedChips() []Chip {
	selected := []Chip{}
	for _, chip := range k.Chips {
		if chip.Selected {
			selected = append(selected, chip)
		}
	}
	return selected
}

// KBSummary is what the studio list sees: no section bodies, no quiz, no chips.
type KBSummary struct {
	ID            string `json:"id"`
	Slug          string `json:"slug"`
	Title         string `json:"title"`
	Tagline       string `json:"tagline"`
	Status        string `json:"status"`
	IngestStatus  string `json:"ingest_status"`
	CandidateName string `json:"candidate_name"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
	SectionCount  int    `json:"section_count"`
	ChipCount     int    `json:"chip_count"`
	QuizCount     int    `json:"quiz_count"`
}

// PublicChip is a selected chip with the candidate's private reasoning removed. The text
// is meant to be tapped by a stranger; `why_it_lands` is a note to self about why this
// question is worth the front page, and has no business in a recruiter's browser.
type PublicChip struct {
	Text string `json:"text"`
}

// PublicSection sells the depth of the knowledge base without giving it away. Titles and
// summaries are public; bodies are the thing the hour is sold on.
type PublicSection struct {
	Ord     int    `json:"ord"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
}

// PublicKB is an allowlist, deliberately, and here that is a security control rather
// than a conversion mechanic.
//
// The whole quiz is withheld: it is the gate a recruiter must pass before booking real
// time, and a leaked `correct_index` turns it into a formality. An omit-list would leak
// every field anyone adds to KnowledgeBase later, quiz included.
type PublicKB struct {
	ID            string          `json:"id"`
	Slug          string          `json:"slug"`
	Title         string          `json:"title"`
	Tagline       string          `json:"tagline"`
	Status        string          `json:"status"`
	CandidateName string          `json:"candidate_name"`
	CandidateBio  string          `json:"candidate_bio"`
	PreRoll       PreRoll         `json:"pre_roll"`
	Chips         []PublicChip    `json:"chips"`
	Sections      []PublicSection `json:"sections"`
}

// IngestRequest is the body of POST /v1/knowledge-bases/ingest.
//
// It carries text, not files. Upload handling and PDF extraction live in the web app's
// route handler (services/web/lib/extract.ts), which keeps pdf.js-quality extraction and
// the designed "this looks like a scan" state in one place, and keeps raw file bytes
// away from Temporal's payload limit.
type IngestRequest struct {
	Title       string   `json:"title"`
	Tagline     string   `json:"tagline"`
	SourceText  string   `json:"source_text"`
	SourceFiles []string `json:"source_files"`
}

// MaxSourceChars mirrors the cap the web route applies before it ever calls us. A
// corpus larger than this is a paste bomb, not a knowledge base.
const MaxSourceChars = 400_000

func (r *IngestRequest) Validate() error {
	if r.SourceFiles == nil {
		r.SourceFiles = []string{}
	}
	if err := checkLength("title", strings.TrimSpace(r.Title), 1, 300); err != nil {
		return err
	}
	if err := checkLength("tagline", strings.TrimSpace(r.Tagline), 1, 500); err != nil {
		return err
	}
	// 200 characters is the same floor the dropzone enforces: below it there is nothing
	// to build a knowledge base from, and a model asked to try will invent one.
	return checkLength("source_text", strings.TrimSpace(r.SourceText), 200, MaxSourceChars)
}

// KBPatch is a partial edit from the review screen. Every field is independently
// saveable, so a nil pointer means "leave this alone" rather than "clear it".
type KBPatch struct {
	Title    *string     `json:"title,omitempty"`
	Tagline  *string     `json:"tagline,omitempty"`
	Sections *[]Section  `json:"sections,omitempty"`
	Chips    *[]Chip     `json:"chips,omitempty"`
	Quiz     *[]QuizItem `json:"quiz,omitempty"`
	PreRoll  *PreRoll    `json:"pre_roll,omitempty"`
}

// IsEmpty reports a patch that would change nothing, which is a client bug worth a 400
// rather than a silent no-op write.
func (p *KBPatch) IsEmpty() bool {
	return p.Title == nil && p.Tagline == nil && p.Sections == nil &&
		p.Chips == nil && p.Quiz == nil && p.PreRoll == nil
}

// Collection caps. Generous relative to what the pipeline produces, because these exist
// to stop a malformed client rather than to second-guess the candidate's editing.
const (
	MaxSections = 40
	MaxChips    = 24
	MaxQuiz     = 40
)

func (p *KBPatch) Validate() error {
	if p.IsEmpty() {
		return invalid("patch", "must change at least one field")
	}
	if p.Title != nil {
		if err := checkLength("title", strings.TrimSpace(*p.Title), 1, 300); err != nil {
			return err
		}
	}
	if p.Tagline != nil {
		if err := checkLength("tagline", *p.Tagline, 0, 500); err != nil {
			return err
		}
	}
	if p.Sections != nil {
		if len(*p.Sections) > MaxSections {
			return invalid("sections", fmt.Sprintf("must contain at most %d items", MaxSections))
		}
		// Ids must be unique: they are what chips and quiz items resolve against, and two
		// sections sharing one turns every reference to it into a coin flip.
		seen := map[string]bool{}
		for index := range *p.Sections {
			section := &(*p.Sections)[index]
			section.Normalize()
			field := fmt.Sprintf("sections[%d]", index)
			if err := section.Validate(field); err != nil {
				return err
			}
			if seen[section.ID()] {
				return invalid(field+".anchor", "duplicates another section's id")
			}
			seen[section.ID()] = true
		}
	}
	if p.Chips != nil {
		if len(*p.Chips) > MaxChips {
			return invalid("chips", fmt.Sprintf("must contain at most %d items", MaxChips))
		}
		for index := range *p.Chips {
			chip := &(*p.Chips)[index]
			chip.Normalize()
			if err := chip.Validate(fmt.Sprintf("chips[%d]", index)); err != nil {
				return err
			}
		}
	}
	if p.Quiz != nil {
		if len(*p.Quiz) > MaxQuiz {
			return invalid("quiz", fmt.Sprintf("must contain at most %d items", MaxQuiz))
		}
		for index := range *p.Quiz {
			item := &(*p.Quiz)[index]
			item.Normalize()
			if err := item.Validate(fmt.Sprintf("quiz[%d]", index)); err != nil {
				return err
			}
		}
	}
	if p.PreRoll != nil {
		p.PreRoll.Normalize()
		return p.PreRoll.Validate("pre_roll")
	}
	return nil
}

// IngestResult is what the Temporal workflow returns: the model's output and nothing
// else. The worker has no database; persistence is this service's job.
type IngestResult struct {
	Sections []Section  `json:"sections"`
	Chips    []Chip     `json:"chips"`
	Quiz     []QuizItem `json:"quiz"`
	PreRoll  PreRoll    `json:"pre_roll"`
}

// IngestProgress is the workflow's get_progress query result. Temporal cannot push, so
// the SSE handler polls this and forwards the lines it has not sent yet.
type IngestProgress struct {
	Status string   `json:"status"`
	Lines  []string `json:"lines"`
	Error  string   `json:"error,omitempty"`
}

// Ingest progress statuses, matching app.core.kb_schemas.IngestProgressStatus.
const (
	ProgressRunning = "running"
	ProgressReady   = "ready"
	ProgressFailed  = "failed"
)

// IngestEvent is one server-sent event on the ingestion stream. The shape is fixed by
// services/web/lib/types.ts IngestEvent, which the ingestion panel already parses:
// a `draft` first (so a failure still leaves a retryable id in the client's hands),
// then `status` lines, then exactly one `result` or `error`.
type IngestEvent struct {
	Type    string `json:"type"`
	Message string `json:"message,omitempty"`
	Code    string `json:"code,omitempty"`
	KBID    string `json:"kb_id,omitempty"`
}

// RephraseRequest is the payload of the chip-rewrite workflow.
type RephraseRequest struct {
	Text     string `json:"text"`
	Register string `json:"register"`
}

// RephraseResult is what that workflow returns.
type RephraseResult struct {
	Text string `json:"text"`
}

// KnowledgeDocument is one document to embed and store. Retained from the reference
// application: Journey 2's hour-long chat is the caller that will need it.
type KnowledgeDocument struct {
	ID       string         `json:"id"`
	Title    string         `json:"title"`
	Content  string         `json:"content"`
	Source   string         `json:"source"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

func (d *KnowledgeDocument) Validate() error {
	if err := checkLength("id", d.ID, 1, 200); err != nil {
		return err
	}
	if err := checkLength("title", d.Title, 1, 300); err != nil {
		return err
	}
	if err := checkLength("content", d.Content, 1, 50000); err != nil {
		return err
	}
	return checkLength("source", d.Source, 1, 500)
}

// VectorUpsertRequest is the body of POST /v1/vectors.
type VectorUpsertRequest struct {
	Documents []KnowledgeDocument `json:"documents"`
}

func (r *VectorUpsertRequest) Validate() error {
	if len(r.Documents) == 0 {
		return invalid("documents", "is required")
	}
	if len(r.Documents) > 100 {
		return invalid("documents", "must contain at most 100 items")
	}
	for index := range r.Documents {
		if err := r.Documents[index].Validate(); err != nil {
			var validation *ValidationError
			if errors.As(err, &validation) {
				return invalid(
					fmt.Sprintf("documents[%d].%s", index, validation.Field),
					validation.Message,
				)
			}
			return err
		}
	}
	return nil
}

// VectorUpsertResponse reports how many documents were written.
type VectorUpsertResponse struct {
	Upserted int `json:"upserted"`
}

// Timestamp renders a time the way every knowledge-base field carries it: RFC 3339 in
// UTC, so the string sorts lexicographically and zod's `z.string()` is satisfied.
func Timestamp(at time.Time) string {
	return at.UTC().Format(time.RFC3339Nano)
}
