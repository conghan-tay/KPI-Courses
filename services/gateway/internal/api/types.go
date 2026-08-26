// Package api defines the public HTTP contract and the payload shapes exchanged with
// the Temporal workflow.
//
// The JSON tags here are a three-way contract. They mirror the Pydantic models in
// services/agent/app/core/course_schemas.py, which cross the Temporal boundary, and the
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

// Course lifecycle, matching web/lib/types.ts CourseStatusSchema.
const (
	StatusDraft     = "draft"
	StatusPublished = "published"
)

// Ingestion lifecycle. POC_UserJourney.md's data model has no such field; it exists
// because the spec requires "ingestion timeout → keep the draft, offer retry", and a
// draft written before the model call is the only thing that makes a retry possible.
const (
	IngestRunning = "running"
	IngestReady   = "ready"
	IngestFailed  = "failed"
)

// ValidationError reports a rejected field so the handler can return 400 with a
// message that tells the caller what to fix. Field is dotted for nested values
// ("lessons[2].title") so a client can put the message next to the input.
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

// User is a seeded identity. POC_UserJourney.md §0 puts real auth off until Monday and
// ships a dev-mode role switcher over two rows; these are those rows, and they are
// seeded by migration to match services/web/lib/seed.ts.
type User struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	Bio       string `json:"bio"`
	AvatarURL string `json:"avatar_url,omitempty"`
}

// Roles, matching web/lib/seed.ts.
const (
	RoleSpecialist = "specialist"
	RoleSeeker     = "seeker"
)

// Position is a stance the Specialist will defend, and it is the paid product: `claim`
// is the hook, `because` is the argument, `pushback` is the thing a book cannot do.
//
// `quote` is not in POC_UserJourney.md §1, but the ingestion prompt says "quote-anchor
// every position to the source text" and the fixture carries one. It is the
// hallucination canary: a span copied verbatim from the source, or nothing.
type Position struct {
	Claim    string `json:"claim"`
	Because  string `json:"because"`
	Pushback string `json:"pushback"`
	Quote    string `json:"quote,omitempty"`
}

func (p *Position) Validate(field string) error {
	if err := checkLength(field+".claim", p.Claim, 1, 500); err != nil {
		return err
	}
	if err := checkLength(field+".because", p.Because, 0, 2000); err != nil {
		return err
	}
	if err := checkLength(field+".pushback", p.Pushback, 0, 2000); err != nil {
		return err
	}
	return checkLength(field+".quote", p.Quote, 0, 4000)
}

// VoiceCard is what makes the tutor feel like a person rather than ChatGPT with a
// textbook stapled to it. `refuses_to` is in the fixture but not the POC sketch.
type VoiceCard struct {
	Register       string   `json:"register"`
	PetPeeves      []string `json:"pet_peeves"`
	SignatureMoves []string `json:"signature_moves"`
	RefusesTo      []string `json:"refuses_to"`
}

// Normalize replaces nil slices with empty ones. The zod schemas default these to `[]`,
// and a JSON `null` where the client expects an array is a parse failure on a screen.
func (v *VoiceCard) Normalize() {
	if v.PetPeeves == nil {
		v.PetPeeves = []string{}
	}
	if v.SignatureMoves == nil {
		v.SignatureMoves = []string{}
	}
	if v.RefusesTo == nil {
		v.RefusesTo = []string{}
	}
}

func (v *VoiceCard) Validate(field string) error {
	return checkLength(field+".register", v.Register, 0, 2000)
}

// Lesson is one unit of the syllabus. Ord is a display ordinal, always 1..n with no
// gaps; the server assigns it, whatever order the client sent.
type Lesson struct {
	Ord       int      `json:"ord"`
	Title     string   `json:"title"`
	Objective string   `json:"objective"`
	KeyPoints []string `json:"key_points"`
	BodyMD    string   `json:"body_md"`
}

func (l *Lesson) Normalize() {
	if l.KeyPoints == nil {
		l.KeyPoints = []string{}
	}
}

func (l *Lesson) Validate(field string) error {
	if err := checkLength(field+".title", l.Title, 1, 300); err != nil {
		return err
	}
	if err := checkLength(field+".objective", l.Objective, 0, 500); err != nil {
		return err
	}
	return checkLength(field+".body_md", l.BodyMD, 0, 100_000)
}

// Course is the full record, and the payload GET /v1/courses/{id} returns to its owner.
// Everything in here except source_text is editable from the review screen.
type Course struct {
	ID             string     `json:"id"`
	SpecialistID   string     `json:"specialist_id"`
	SpecialistName string     `json:"specialist_name"`
	SpecialistBio  string     `json:"specialist_bio"`
	Slug           string     `json:"slug"`
	Title          string     `json:"title"`
	Tagline        string     `json:"tagline"`
	PriceCents     int        `json:"price_cents"`
	Status         string     `json:"status"`
	IngestStatus   string     `json:"ingest_status"`
	IngestError    string     `json:"ingest_error,omitempty"`
	VoiceCard      VoiceCard  `json:"voice_card"`
	Positions      []Position `json:"positions"`
	Lessons        []Lesson   `json:"lessons"`
	// SourceText is the full raw corpus. No RAG: POC_UserJourney.md §0 is explicit that
	// a course is under 60k tokens and the whole thing goes in the prompt.
	SourceText  string   `json:"source_text"`
	SourceFiles []string `json:"source_files"`
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at"`
}

// Normalize makes every collection non-nil, so the client always gets `[]` not `null`.
func (c *Course) Normalize() {
	if c.Positions == nil {
		c.Positions = []Position{}
	}
	if c.Lessons == nil {
		c.Lessons = []Lesson{}
	}
	if c.SourceFiles == nil {
		c.SourceFiles = []string{}
	}
	c.VoiceCard.Normalize()
	for index := range c.Lessons {
		c.Lessons[index].Normalize()
	}
}

// CourseSummary is what the studio list sees: no lesson bodies, no stances.
type CourseSummary struct {
	ID             string `json:"id"`
	Slug           string `json:"slug"`
	Title          string `json:"title"`
	Tagline        string `json:"tagline"`
	PriceCents     int    `json:"price_cents"`
	Status         string `json:"status"`
	IngestStatus   string `json:"ingest_status"`
	SpecialistName string `json:"specialist_name"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
	LessonCount    int    `json:"lesson_count"`
	PositionCount  int    `json:"position_count"`
}

// PublicPosition is a stance with the argument withheld. DESIGN.md §4.5: the claim is
// the hook and is meant to be read by a stranger; `because`, `pushback` and the source
// quote are the product, and a CSS blur is one devtools inspection away from leaking
// them. So the projection happens here, and the locked card has nothing to reveal.
type PublicPosition struct {
	Claim string `json:"claim"`
}

// PublicLesson sells the syllabus. Objectives are public; bodies and key points are not.
type PublicLesson struct {
	Ord       int    `json:"ord"`
	Title     string `json:"title"`
	Objective string `json:"objective"`
}

// PublicCourse is an allowlist, deliberately. An omit-list leaks every field anyone adds
// to Course later — including voice_card, which is the persona spec Journey 2's sample
// chat runs on and has no business in a stranger's browser.
type PublicCourse struct {
	ID             string           `json:"id"`
	Slug           string           `json:"slug"`
	Title          string           `json:"title"`
	Tagline        string           `json:"tagline"`
	PriceCents     int              `json:"price_cents"`
	Status         string           `json:"status"`
	SpecialistName string           `json:"specialist_name"`
	SpecialistBio  string           `json:"specialist_bio"`
	Positions      []PublicPosition `json:"positions"`
	Lessons        []PublicLesson   `json:"lessons"`
}

// IngestRequest is the body of POST /v1/courses/ingest.
//
// It carries text, not files. Upload handling and PDF extraction live in the web app's
// route handler (services/web/lib/extract.ts), which keeps pdf.js-quality extraction and
// the designed "this looks like a scan" state in one place, and keeps raw file bytes
// away from Temporal's payload limit.
type IngestRequest struct {
	Title       string   `json:"title"`
	Tagline     string   `json:"tagline"`
	PriceCents  int      `json:"price_cents"`
	SourceText  string   `json:"source_text"`
	SourceFiles []string `json:"source_files"`
}

// MaxSourceChars mirrors the cap the web route applies before it ever calls us. A
// corpus larger than this is a paste bomb, not a course.
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
	if r.PriceCents <= 0 {
		return invalid("price_cents", "must be a positive number of cents")
	}
	// 200 characters is the same floor the dropzone enforces: below it there is nothing
	// to build a course from, and a model asked to try will invent one.
	return checkLength("source_text", strings.TrimSpace(r.SourceText), 200, MaxSourceChars)
}

// CoursePatch is a partial edit from the review screen. Every field is independently
// saveable, so a nil pointer means "leave this alone" rather than "clear it".
type CoursePatch struct {
	Title      *string     `json:"title,omitempty"`
	Tagline    *string     `json:"tagline,omitempty"`
	PriceCents *int        `json:"price_cents,omitempty"`
	Lessons    *[]Lesson   `json:"lessons,omitempty"`
	Positions  *[]Position `json:"positions,omitempty"`
	VoiceCard  *VoiceCard  `json:"voice_card,omitempty"`
}

// IsEmpty reports a patch that would change nothing, which is a client bug worth a 400
// rather than a silent no-op write.
func (p *CoursePatch) IsEmpty() bool {
	return p.Title == nil && p.Tagline == nil && p.PriceCents == nil &&
		p.Lessons == nil && p.Positions == nil && p.VoiceCard == nil
}

func (p *CoursePatch) Validate() error {
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
	if p.PriceCents != nil && *p.PriceCents < 0 {
		return invalid("price_cents", "must not be negative")
	}
	if p.Lessons != nil {
		if len(*p.Lessons) > 50 {
			return invalid("lessons", "must contain at most 50 items")
		}
		for index := range *p.Lessons {
			lesson := &(*p.Lessons)[index]
			lesson.Normalize()
			if err := lesson.Validate(fmt.Sprintf("lessons[%d]", index)); err != nil {
				return err
			}
		}
	}
	if p.Positions != nil {
		if len(*p.Positions) > 50 {
			return invalid("positions", "must contain at most 50 items")
		}
		for index := range *p.Positions {
			position := &(*p.Positions)[index]
			if err := position.Validate(fmt.Sprintf("positions[%d]", index)); err != nil {
				return err
			}
		}
	}
	if p.VoiceCard != nil {
		p.VoiceCard.Normalize()
		return p.VoiceCard.Validate("voice_card")
	}
	return nil
}

// IngestResult is what the Temporal workflow returns: the model's output and nothing
// else. The worker has no database; persistence is this service's job.
type IngestResult struct {
	Lessons   []Lesson   `json:"lessons"`
	Positions []Position `json:"positions"`
	VoiceCard VoiceCard  `json:"voice_card"`
}

// IngestProgress is the workflow's get_progress query result. Temporal cannot push, so
// the SSE handler polls this and forwards the lines it has not sent yet.
type IngestProgress struct {
	Status string   `json:"status"`
	Lines  []string `json:"lines"`
	Error  string   `json:"error,omitempty"`
}

// Ingest progress statuses, matching app.core.course_schemas.IngestProgressStatus.
const (
	ProgressRunning = "running"
	ProgressReady   = "ready"
	ProgressFailed  = "failed"
)

// IngestEvent is one server-sent event on the ingestion stream. The shape is fixed by
// services/web/lib/types.ts IngestEvent, which the ingestion panel already parses:
// a `draft` first (so a failure still leaves a retryable course id in the client's
// hands), then `status` lines, then exactly one `result` or `error`.
type IngestEvent struct {
	Type     string `json:"type"`
	Message  string `json:"message,omitempty"`
	Code     string `json:"code,omitempty"`
	CourseID string `json:"course_id,omitempty"`
}

// SoftenRequest is the payload of the claim-rewrite workflow.
type SoftenRequest struct {
	Claim string `json:"claim"`
}

// SoftenResult is what that workflow returns.
type SoftenResult struct {
	Claim string `json:"claim"`
}

// KnowledgeDocument is one document to embed and store. Retained from the reference
// application: Journey 3's tutor is the caller that will need it.
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

// KnowledgeUpsertRequest is the body of POST /v1/knowledge.
type KnowledgeUpsertRequest struct {
	Documents []KnowledgeDocument `json:"documents"`
}

func (r *KnowledgeUpsertRequest) Validate() error {
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

// KnowledgeUpsertResponse reports how many documents were written.
type KnowledgeUpsertResponse struct {
	Upserted int `json:"upserted"`
}

// Timestamp renders a time the way every course field carries it: RFC 3339 in UTC, so
// the string sorts lexicographically and zod's `z.string()` is satisfied.
func Timestamp(at time.Time) string {
	return at.UTC().Format(time.RFC3339Nano)
}
