package courses

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/example/kpi-courses/services/gateway/internal/api"
)

func fixtureCourse() api.Course {
	course := api.Course{
		ID:             "course-1",
		SpecialistID:   "user-dana",
		SpecialistName: "Dana Mercado",
		SpecialistBio:  "Fixes pricing for services businesses.",
		Slug:           "hold-your-number",
		Title:          "Hold Your Number",
		Tagline:        "Stop discounting to close.",
		PriceCents:     34900,
		Status:         api.StatusDraft,
		IngestStatus:   api.IngestReady,
		VoiceCard: api.VoiceCard{
			Register:  "blunt, uses pump-plant analogies",
			PetPeeves: []string{"value-based pricing as a slogan"},
		},
		Positions: []api.Position{
			{
				Claim:    "A price objection is never about price.",
				Because:  "Every pricing problem arrives disguised as a discount request.",
				Pushback: "But they said it's too expensive → they always say that",
				Quote:    "Every pricing problem arrives disguised",
			},
		},
		Lessons: []api.Lesson{
			{
				Ord:       1,
				Title:     "The Objection You Hear Is Not The One You Have",
				Objective: "Can separate a stated objection from a real one",
				KeyPoints: []string{"listen for the second sentence"},
				BodyMD:    "# Lesson one\n\nThe body of the lesson.",
			},
		},
		SourceText:  "the whole corpus",
		SourceFiles: []string{"source.md"},
		CreatedAt:   "2026-08-26T10:00:00Z",
		UpdatedAt:   "2026-08-26T10:00:00Z",
	}
	course.Normalize()
	return course
}

// The §4.5 withholding rule, asserted the way it actually fails: on the serialized
// bytes. A field that survives into the JSON is leaked whether or not a component
// renders it.
func TestPublicProjectionWithholdsTheArgument(t *testing.T) {
	body, err := json.Marshal(ToPublic(fixtureCourse()))
	if err != nil {
		t.Fatalf("marshal public course: %v", err)
	}
	payload := string(body)

	for _, forbidden := range []string{
		"because", "pushback", "quote", "body_md", "key_points", "source_text",
		"source_files", "voice_card", "specialist_id", "ingest_status",
		// The argument itself, not just its key: this phrase is the fixture's, and it
		// is the string the Playwright smoke greps the response for.
		"Every pricing problem arrives disguised",
		"the whole corpus",
	} {
		if strings.Contains(payload, forbidden) {
			t.Errorf("public projection leaked %q: %s", forbidden, payload)
		}
	}

	public := ToPublic(fixtureCourse())
	if len(public.Positions) != 1 || public.Positions[0].Claim == "" {
		t.Fatalf("the claim is the hook and must survive: %+v", public.Positions)
	}
	if len(public.Lessons) != 1 || public.Lessons[0].Objective == "" {
		t.Fatalf("objectives sell the syllabus and must survive: %+v", public.Lessons)
	}
}

func TestSummaryCountsWithoutCarryingContent(t *testing.T) {
	summary := ToSummary(fixtureCourse())

	if summary.LessonCount != 1 || summary.PositionCount != 1 {
		t.Fatalf("counts = %d lessons, %d positions", summary.LessonCount, summary.PositionCount)
	}
	body, err := json.Marshal(summary)
	if err != nil {
		t.Fatalf("marshal summary: %v", err)
	}
	if strings.Contains(string(body), "body_md") {
		t.Fatalf("summary carried lesson bodies: %s", body)
	}
}

func TestPublishBlockers(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(*api.Course)
		want    string
		blocked bool
	}{
		{name: "a complete course publishes", mutate: func(*api.Course) {}},
		{
			name:    "no title",
			mutate:  func(c *api.Course) { c.Title = "   " },
			want:    "title",
			blocked: true,
		},
		{
			name:    "no tagline",
			mutate:  func(c *api.Course) { c.Tagline = "" },
			want:    "tagline",
			blocked: true,
		},
		{
			name:    "free",
			mutate:  func(c *api.Course) { c.PriceCents = 0 },
			want:    "price",
			blocked: true,
		},
		{
			name:    "no lessons",
			mutate:  func(c *api.Course) { c.Lessons = nil },
			want:    "nothing to teach",
			blocked: true,
		},
		{
			name:    "still ingesting",
			mutate:  func(c *api.Course) { c.IngestStatus = api.IngestRunning },
			want:    "still running",
			blocked: true,
		},
		{
			// POC_UserJourney.md: "fewer than 3 positions found → warn but allow
			// publish". A Specialist with forty pages of craft and two opinions still
			// has something to sell.
			name:   "thin on positions warns but does not block",
			mutate: func(c *api.Course) { c.Positions = nil },
		},
		{
			name:   "a failed ingestion with lessons from a previous run still publishes",
			mutate: func(c *api.Course) { c.IngestStatus = api.IngestFailed },
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			course := fixtureCourse()
			testCase.mutate(&course)

			blockers := PublishBlockers(course)

			if testCase.blocked {
				if len(blockers) == 0 {
					t.Fatal("expected a blocker, got none")
				}
				if !strings.Contains(strings.Join(blockers, " "), testCase.want) {
					t.Fatalf("blockers = %v, want mention of %q", blockers, testCase.want)
				}
				return
			}
			if len(blockers) != 0 {
				t.Fatalf("blockers = %v, want none", blockers)
			}
		})
	}
}

func TestRenumberAssignsDisplayOrdinals(t *testing.T) {
	// What a reorder on the review screen sends: the right order, the wrong numbers.
	lessons := []api.Lesson{
		{Ord: 3, Title: "third"},
		{Ord: 1, Title: "first"},
		{Ord: 9, Title: "ninth"},
	}

	renumbered := Renumber(lessons)

	for index, lesson := range renumbered {
		if lesson.Ord != index+1 {
			t.Fatalf("lesson %d has ord %d", index, lesson.Ord)
		}
		if lesson.KeyPoints == nil {
			t.Fatalf("lesson %d kept a nil key_points, which serializes as null", index)
		}
	}
	if renumbered[0].Title != "third" {
		t.Fatalf("renumber reordered the list: %+v", renumbered)
	}
	// The caller's slice must not be rewritten under it.
	if lessons[0].Ord != 3 {
		t.Fatal("Renumber mutated its argument")
	}
}

func TestApplyPatchOnlyTouchesWhatWasSent(t *testing.T) {
	course := fixtureCourse()
	title := "A New Title"

	patched := ApplyPatch(course, api.CoursePatch{Title: &title})

	if patched.Title != title {
		t.Fatalf("title = %q", patched.Title)
	}
	if patched.Tagline != course.Tagline || len(patched.Lessons) != 1 {
		t.Fatalf("a title-only patch changed something else: %+v", patched)
	}
	if patched.SourceText != course.SourceText {
		t.Fatal("a patch cleared the source text, which no retry could recover")
	}
}

func TestApplyPatchRenumbersReorderedLessons(t *testing.T) {
	course := fixtureCourse()
	lessons := []api.Lesson{{Ord: 7, Title: "b"}, {Ord: 2, Title: "a"}}

	patched := ApplyPatch(course, api.CoursePatch{Lessons: &lessons})

	if patched.Lessons[0].Ord != 1 || patched.Lessons[1].Ord != 2 {
		t.Fatalf("ordinals = %+v", patched.Lessons)
	}
}

func TestDraftIsRetryableBeforeTheModelRuns(t *testing.T) {
	user := api.User{ID: "user-dana", Name: "Dana Mercado", Bio: "Pricing."}
	request := api.IngestRequest{
		Title: "Hold Your Number", Tagline: "Stop discounting.",
		PriceCents: 34900, SourceText: "corpus", SourceFiles: []string{"source.md"},
	}

	draft := NewDraft("course-1", user, request, "2026-08-26T10:00:00Z")

	// The three things a retry needs: an id, the source text, and a status that says
	// this is unfinished rather than empty.
	if draft.IngestStatus != api.IngestRunning {
		t.Fatalf("ingest_status = %q", draft.IngestStatus)
	}
	if draft.SourceText == "" {
		t.Fatal("the draft dropped the source text, so a retry would need a re-upload")
	}
	if draft.Slug != "hold-your-number" {
		t.Fatalf("slug = %q", draft.Slug)
	}
	if draft.Positions == nil || draft.Lessons == nil || draft.VoiceCard.PetPeeves == nil {
		t.Fatalf("empty collections must serialize as [] not null: %+v", draft)
	}
}

func TestIngestFailureKeepsTheDraft(t *testing.T) {
	draft := fixtureCourse()

	failed := MarkIngestFailed(draft, "The model did not answer within 180s.")

	if failed.IngestStatus != api.IngestFailed || failed.IngestError == "" {
		t.Fatalf("failed draft = %+v", failed)
	}
	if failed.SourceText != draft.SourceText {
		t.Fatal("a failure discarded the source text")
	}

	retrying := MarkIngestRunning(failed)
	if retrying.IngestStatus != api.IngestRunning || retrying.IngestError != "" {
		t.Fatalf("retry did not clear the previous error: %+v", retrying)
	}
}

func TestApplyIngestResultNumbersLessonsTheServerWay(t *testing.T) {
	draft := NewDraft(
		"course-1", api.User{ID: "user-dana"},
		api.IngestRequest{Title: "T", Tagline: "t", PriceCents: 1, SourceText: "s"},
		"2026-08-26T10:00:00Z",
	)
	result := api.IngestResult{
		// The model omitted every ordinal, which it is allowed to do.
		Lessons:   []api.Lesson{{Title: "one"}, {Title: "two"}},
		Positions: []api.Position{{Claim: "c"}},
	}

	ready := ApplyIngestResult(draft, result)

	if ready.IngestStatus != api.IngestReady {
		t.Fatalf("ingest_status = %q", ready.IngestStatus)
	}
	if ready.Lessons[0].Ord != 1 || ready.Lessons[1].Ord != 2 {
		t.Fatalf("ordinals = %+v", ready.Lessons)
	}
}

func TestSlugify(t *testing.T) {
	cases := []struct{ input, want string }{
		{"Hold Your Number", "hold-your-number"},
		{"  Spaces   Everywhere  ", "spaces-everywhere"},
		{"Café Pricing", "cafe-pricing"},
		{"Pricing: the 2nd edition!", "pricing-the-2nd-edition"},
		{"—— ——", "course"},
		{"", "course"},
		{
			strings.Repeat("long ", 40),
			// Truncated at 60 characters, then trimmed so it never ends in a hyphen.
			"long-long-long-long-long-long-long-long-long-long-long-long",
		},
	}

	for _, testCase := range cases {
		if got := Slugify(testCase.input); got != testCase.want {
			t.Errorf("Slugify(%q) = %q, want %q", testCase.input, got, testCase.want)
		}
	}
}
