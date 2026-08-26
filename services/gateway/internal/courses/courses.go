// Package courses holds the rules of Journey 1: what a draft looks like before the
// model has run, what a stranger is allowed to see, and what must be true before a
// course can go live.
//
// Everything in this file is a pure function of its arguments. That is the point: these
// rules used to live in the web app's route handlers, where testing them meant standing
// up Next, and they are the rules Journeys 2 and 3 inherit.
package courses

import (
	"fmt"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"github.com/example/kpi-courses/services/gateway/internal/api"
)

// NewDraft builds the row that is written *before* the model is called.
//
// That ordering is the whole of "ingestion timeout → keep the draft, offer retry": a
// course in ingest_status "running" is one that exists and has no lessons yet, and a
// failure leaves something to retry instead of a lost upload.
func NewDraft(
	id string, user api.User, request api.IngestRequest, now string,
) api.Course {
	course := api.Course{
		ID:             id,
		SpecialistID:   user.ID,
		SpecialistName: user.Name,
		SpecialistBio:  user.Bio,
		Slug:           Slugify(request.Title),
		Title:          strings.TrimSpace(request.Title),
		Tagline:        strings.TrimSpace(request.Tagline),
		PriceCents:     request.PriceCents,
		Status:         api.StatusDraft,
		IngestStatus:   api.IngestRunning,
		SourceText:     request.SourceText,
		SourceFiles:    request.SourceFiles,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	course.Normalize()
	return course
}

// ApplyIngestResult folds the model's output into a draft.
//
// The model may omit ordinals or number them badly; they are ours to assign either way,
// so the incoming order is respected and the numbering is not.
func ApplyIngestResult(course api.Course, result api.IngestResult) api.Course {
	course.Lessons = Renumber(result.Lessons)
	course.Positions = result.Positions
	course.VoiceCard = result.VoiceCard
	course.IngestStatus = api.IngestReady
	course.IngestError = ""
	course.Normalize()
	return course
}

// MarkIngestFailed keeps the draft and records why, which is what the review screen's
// [RETRY INGESTION] state reads.
func MarkIngestFailed(course api.Course, message string) api.Course {
	course.IngestStatus = api.IngestFailed
	course.IngestError = message
	return course
}

// MarkIngestRunning resets a failed draft for a retry.
func MarkIngestRunning(course api.Course) api.Course {
	course.IngestStatus = api.IngestRunning
	course.IngestError = ""
	return course
}

// ApplyPatch applies a partial edit from the review screen. A nil field means "leave
// this alone"; only what the client sent is touched.
func ApplyPatch(course api.Course, patch api.CoursePatch) api.Course {
	if patch.Title != nil {
		course.Title = strings.TrimSpace(*patch.Title)
	}
	if patch.Tagline != nil {
		course.Tagline = strings.TrimSpace(*patch.Tagline)
	}
	if patch.PriceCents != nil {
		course.PriceCents = *patch.PriceCents
	}
	if patch.Lessons != nil {
		course.Lessons = Renumber(*patch.Lessons)
	}
	if patch.Positions != nil {
		course.Positions = *patch.Positions
	}
	if patch.VoiceCard != nil {
		course.VoiceCard = *patch.VoiceCard
	}
	course.Normalize()
	return course
}

// Renumber makes `ord` a display ordinal again: 1..n with no gaps, in the order given.
// Reordering on the review screen is a reorder of the slice; the numbers follow.
func Renumber(lessons []api.Lesson) []api.Lesson {
	out := make([]api.Lesson, len(lessons))
	for index, lesson := range lessons {
		lesson.Ord = index + 1
		lesson.Normalize()
		out[index] = lesson
	}
	return out
}

// PublishBlockers lists what must be fixed before a course can be made public.
//
// Thin positions are deliberately absent. POC_UserJourney.md is explicit that fewer
// than three stances warns but never blocks: a Specialist with two opinions and forty
// pages of craft still has a course worth selling, and a hard gate there tells a
// perfectly good expert their opinions aren't interesting.
func PublishBlockers(course api.Course) []string {
	blockers := []string{}
	if strings.TrimSpace(course.Title) == "" {
		blockers = append(blockers, "The course needs a title.")
	}
	if strings.TrimSpace(course.Tagline) == "" {
		blockers = append(
			blockers, "The course needs a tagline — one line, about ten words.",
		)
	}
	if course.PriceCents <= 0 {
		blockers = append(blockers, "Set a price. Free courses can't be published yet.")
	}
	if len(course.Lessons) == 0 {
		blockers = append(blockers, "A course with no lessons has nothing to teach.")
	}
	if course.IngestStatus == api.IngestRunning {
		blockers = append(blockers, "Ingestion is still running.")
	}
	return blockers
}

// ToPublic is the §4.5 withholding rule, and it is engineering rather than styling.
//
// DESIGN.md is explicit that the argument must be omitted for unauthenticated requests
// rather than rendered and blurred, because a CSS blur is one devtools inspection away
// from giving away the entire paid product. So the projection happens here and the
// locked card genuinely has nothing to render.
//
// It is an allowlist. An omit-list leaks every field anyone adds to Course later.
func ToPublic(course api.Course) api.PublicCourse {
	positions := make([]api.PublicPosition, len(course.Positions))
	for index, position := range course.Positions {
		// The claim is the hook and is meant to be read by a stranger. The argument,
		// the counter-argument and the source quote are what they are paying for.
		positions[index] = api.PublicPosition{Claim: position.Claim}
	}
	lessons := make([]api.PublicLesson, len(course.Lessons))
	for index, lesson := range course.Lessons {
		// Objectives sell the syllabus; bodies and key points are the course.
		lessons[index] = api.PublicLesson{
			Ord: lesson.Ord, Title: lesson.Title, Objective: lesson.Objective,
		}
	}
	return api.PublicCourse{
		ID:             course.ID,
		Slug:           course.Slug,
		Title:          course.Title,
		Tagline:        course.Tagline,
		PriceCents:     course.PriceCents,
		Status:         course.Status,
		SpecialistName: course.SpecialistName,
		SpecialistBio:  course.SpecialistBio,
		Positions:      positions,
		Lessons:        lessons,
	}
}

// ToSummary is the studio list row: no bodies, no stances, just counts.
func ToSummary(course api.Course) api.CourseSummary {
	return api.CourseSummary{
		ID:             course.ID,
		Slug:           course.Slug,
		Title:          course.Title,
		Tagline:        course.Tagline,
		PriceCents:     course.PriceCents,
		Status:         course.Status,
		IngestStatus:   course.IngestStatus,
		SpecialistName: course.SpecialistName,
		CreatedAt:      course.CreatedAt,
		UpdatedAt:      course.UpdatedAt,
		LessonCount:    len(course.Lessons),
		PositionCount:  len(course.Positions),
	}
}

const maxSlugLength = 60

// Slugify produces the URL-safe slug behind /c/:slug. Collisions are the store's to
// resolve; this only has to be deterministic.
//
// It mirrors slugify in web/lib/text.ts step for step — NFKD, drop combining marks,
// lowercase, collapse everything else to hyphens, trim, truncate, trim again — so a
// course keeps the same URL whichever side of the wire computed it. "Café Pricing"
// becomes "cafe-pricing" in both, not "caf-pricing" in one of them.
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
		return "course"
	}
	return slug
}

// PublicURL is the shareable link the publish dialog copies. The page it points at is
// Journey 2's; the link is minted here because the slug is.
func PublicURL(course api.Course) string {
	return fmt.Sprintf("/c/%s", course.Slug)
}
