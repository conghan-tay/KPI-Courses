package kb

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/example/reverse-interview/services/gateway/internal/api"
)

func fixtureKB() api.KnowledgeBase {
	knowledgeBase := api.KnowledgeBase{
		ID:            "kb-1",
		CandidateID:   "user-arun",
		CandidateName: "Arun Velasco",
		CandidateBio:  "Payments engineer.",
		Slug:          "arun-velasco",
		Title:         "Arun Velasco",
		Tagline:       "Payments engineer. Eleven years, four employers, one gap.",
		Status:        api.StatusDraft,
		IngestStatus:  api.IngestReady,
		PreRoll: api.PreRoll{
			Headline: "Sixty minutes. Starts when you hit send.",
			Bullets:  []string{"Full timeline, four employers, gap included"},
		},
		Chips: []api.Chip{
			{
				Text:       "why did he leave agoda?",
				KBSection:  "career/timeline#agoda-exit",
				Register:   api.RegisterBlunt,
				Selected:   true,
				WhyItLands: "Every recruiter asks it eventually.",
			},
			{
				Text:      "how deep is his postgres actually?",
				KBSection: "postgres/opinions",
				Register:  api.RegisterSkeptical,
				Selected:  true,
			},
			{
				Text:      "walk me through the virtual card issuing flow",
				KBSection: "postgres/opinions",
				Register:  api.RegisterNarrative,
				Selected:  true,
			},
			{
				Text:      "is the web3 work real or a side project?",
				KBSection: "postgres/opinions",
				Register:  api.RegisterBlunt,
			},
		},
		Quiz: quizWithEveryCategory(),
		Sections: []api.Section{
			{
				Ord:         1,
				Path:        "career/timeline",
				Anchor:      "agoda-exit",
				Title:       "Why he left Agoda",
				Summary:     "One paragraph, no wandering.",
				BodyMD:      "# Why he left\n\nThe platform reached the state he wanted.",
				SourceNames: []string{"career-notes.md"},
			},
			{
				Ord:     2,
				Path:    "postgres/opinions",
				Title:   "Postgres opinions he'll defend",
				Summary: "Six stated positions from five years of running one cluster hard.",
				BodyMD:  "A queue in your database is the correct default.",
			},
		},
		SourceText:  "the whole corpus",
		SourceFiles: []string{"resume.md"},
		CreatedAt:   "2026-08-26T10:00:00Z",
		UpdatedAt:   "2026-08-26T10:00:00Z",
	}
	knowledgeBase.Normalize()
	return knowledgeBase
}

// A quiz that satisfies the gate: one item in every category it samples from.
func quizWithEveryCategory() []api.QuizItem {
	items := make([]api.QuizItem, 0, len(QuizCategories))
	for index, category := range QuizCategories {
		items = append(items, api.QuizItem{
			ID:            string(rune('a' + index)),
			Category:      category,
			Question:      "A question about " + category,
			Choices:       []string{"one", "two", "three", "four"},
			CorrectIndex:  1,
			Rationale:     "Because the knowledge base says so.",
			SourceSection: "postgres/opinions",
		})
	}
	return items
}

// The withholding rule, asserted the way it actually fails: on the serialized bytes. A
// field that survives into the JSON is leaked whether or not a component renders it.
func TestPublicProjectionWithholdsTheQuizAndTheBodies(t *testing.T) {
	body, err := json.Marshal(ToPublic(fixtureKB()))
	if err != nil {
		t.Fatalf("marshal public knowledge base: %v", err)
	}
	payload := string(body)

	for _, forbidden := range []string{
		// The quiz, entirely. This one is a security control: it gates booking real
		// time, and a leaked correct_index turns the gate into a formality.
		"quiz", "correct_index", "choices", "rationale",
		// The candidate's private reasoning, the bodies, and the corpus.
		"why_it_lands", "body_md", "source_text", "source_files", "kb_section",
		"candidate_id", "ingest_status",
		// Content, not just keys: these strings are the fixture's, and their absence is
		// what the Playwright smoke actually greps for.
		"Every recruiter asks it eventually",
		"A queue in your database is the correct default",
		"the whole corpus",
	} {
		if strings.Contains(payload, forbidden) {
			t.Errorf("public projection leaked %q: %s", forbidden, payload)
		}
	}

	public := ToPublic(fixtureKB())
	// Only the three selected chips reach a stranger; the fourth is a draft the
	// candidate chose not to show.
	if len(public.Chips) != 3 {
		t.Fatalf("public chips = %d, want the 3 selected: %+v", len(public.Chips), public.Chips)
	}
	if public.Chips[0].Text == "" {
		t.Fatal("the chip text is the hook and must survive")
	}
	if len(public.Sections) != 2 || public.Sections[0].Summary == "" {
		t.Fatalf("summaries say what is loaded and must survive: %+v", public.Sections)
	}
	if len(public.PreRoll.Bullets) != 1 {
		t.Fatalf("the pre-roll is the whole public page: %+v", public.PreRoll)
	}
}

func TestSummaryCountsWithoutCarryingContent(t *testing.T) {
	summary := ToSummary(fixtureKB())

	if summary.SectionCount != 2 || summary.ChipCount != 4 || summary.QuizCount != 4 {
		t.Fatalf("counts = %+v", summary)
	}
	body, err := json.Marshal(summary)
	if err != nil {
		t.Fatalf("marshal summary: %v", err)
	}
	for _, forbidden := range []string{"body_md", "correct_index"} {
		if strings.Contains(string(body), forbidden) {
			t.Fatalf("summary carried %q: %s", forbidden, body)
		}
	}
}

func TestPublishBlockers(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(*api.KnowledgeBase)
		want    string
		blocked bool
	}{
		{name: "a complete knowledge base publishes", mutate: func(*api.KnowledgeBase) {}},
		{
			name:    "no name",
			mutate:  func(k *api.KnowledgeBase) { k.Title = "   " },
			want:    "name",
			blocked: true,
		},
		{
			name:    "no one-liner",
			mutate:  func(k *api.KnowledgeBase) { k.Tagline = "" },
			want:    "one line",
			blocked: true,
		},
		{
			name:    "no sections",
			mutate:  func(k *api.KnowledgeBase) { k.Sections = nil },
			want:    "nothing to answer from",
			blocked: true,
		},
		{
			// Two on the front page is a broken screen, not a thin one.
			name: "too few chips selected",
			mutate: func(k *api.KnowledgeBase) {
				k.Chips[0].Selected = false
			},
			want:    "exactly 3",
			blocked: true,
		},
		{
			name: "too many chips selected",
			mutate: func(k *api.KnowledgeBase) {
				k.Chips[3].Selected = true
			},
			want:    "exactly 3",
			blocked: true,
		},
		{
			// The gate samples one item per category. A missing category means it
			// cannot ask four questions, which is a gate that does not exist.
			name: "a quiz category with nothing in it",
			mutate: func(k *api.KnowledgeBase) {
				k.Quiz = k.Quiz[:2]
			},
			want:    "every category",
			blocked: true,
		},
		{
			name:    "still ingesting",
			mutate:  func(k *api.KnowledgeBase) { k.IngestStatus = api.IngestRunning },
			want:    "still building",
			blocked: true,
		},
		{
			// A candidate with a sparse corpus still has something worth publishing.
			name: "a thin but complete knowledge base warns rather than blocks",
			mutate: func(k *api.KnowledgeBase) {
				k.Sections = k.Sections[:1]
			},
		},
		{
			name:   "a failed ingestion with content from a previous run still publishes",
			mutate: func(k *api.KnowledgeBase) { k.IngestStatus = api.IngestFailed },
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			knowledgeBase := fixtureKB()
			testCase.mutate(&knowledgeBase)

			blockers := PublishBlockers(knowledgeBase)

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

func TestUnresolvedRefsFindADeletedSection(t *testing.T) {
	knowledgeBase := fixtureKB()
	if got := UnresolvedChips(knowledgeBase); len(got) != 0 {
		t.Fatalf("the fixture's own references should resolve: %v", got)
	}

	// The case the pipeline cannot prevent: the candidate deletes a section on the
	// review screen out from under three chips and a quiz item that cite it.
	knowledgeBase.Sections = knowledgeBase.Sections[:1]

	if got := UnresolvedChips(knowledgeBase); len(got) != 3 {
		t.Fatalf("unresolved chips = %v, want the 3 citing postgres/opinions", got)
	}
	if got := UnresolvedQuiz(knowledgeBase); len(got) != len(knowledgeBase.Quiz) {
		t.Fatalf("unresolved quiz = %v, want all of them", got)
	}
}

func TestRenumberAssignsDisplayOrdinals(t *testing.T) {
	// What a reorder on the review screen sends: the right order, the wrong numbers.
	sections := []api.Section{
		{Ord: 3, Path: "c", Title: "third"},
		{Ord: 1, Path: "a", Title: "first"},
		{Ord: 9, Path: "i", Title: "ninth"},
	}

	renumbered := Renumber(sections)

	for index, section := range renumbered {
		if section.Ord != index+1 {
			t.Fatalf("section %d has ord %d", index, section.Ord)
		}
		if section.SourceNames == nil {
			t.Fatalf("section %d kept a nil source_names, which serializes as null", index)
		}
	}
	if renumbered[0].Title != "third" {
		t.Fatalf("renumber reordered the list: %+v", renumbered)
	}
	// The caller's slice must not be rewritten under it.
	if sections[0].Ord != 3 {
		t.Fatal("Renumber mutated its argument")
	}
}

func TestApplyPatchOnlyTouchesWhatWasSent(t *testing.T) {
	knowledgeBase := fixtureKB()
	title := "A New Name"

	patched := ApplyPatch(knowledgeBase, api.KBPatch{Title: &title})

	if patched.Title != title {
		t.Fatalf("title = %q", patched.Title)
	}
	if patched.Tagline != knowledgeBase.Tagline || len(patched.Sections) != 2 {
		t.Fatalf("a title-only patch changed something else: %+v", patched)
	}
	if len(patched.Quiz) != len(knowledgeBase.Quiz) {
		t.Fatal("a title-only patch dropped the quiz")
	}
	if patched.SourceText != knowledgeBase.SourceText {
		t.Fatal("a patch cleared the source text, which no retry could recover")
	}
}

func TestApplyPatchRenumbersReorderedSections(t *testing.T) {
	knowledgeBase := fixtureKB()
	sections := []api.Section{{Ord: 7, Path: "b", Title: "b"}, {Ord: 2, Path: "a", Title: "a"}}

	patched := ApplyPatch(knowledgeBase, api.KBPatch{Sections: &sections})

	if patched.Sections[0].Ord != 1 || patched.Sections[1].Ord != 2 {
		t.Fatalf("ordinals = %+v", patched.Sections)
	}
}

func TestDraftIsRetryableBeforeThePipelineRuns(t *testing.T) {
	user := api.User{ID: "user-arun", Name: "Arun Velasco", Bio: "Payments."}
	request := api.IngestRequest{
		Title: "Arun Velasco", Tagline: "Payments engineer.",
		SourceText: "corpus", SourceFiles: []string{"resume.md"},
	}

	draft := NewDraft("kb-1", user, request, "2026-08-26T10:00:00Z")

	// The three things a retry needs: an id, the source text, and a status that says
	// this is unfinished rather than empty.
	if draft.IngestStatus != api.IngestRunning {
		t.Fatalf("ingest_status = %q", draft.IngestStatus)
	}
	if draft.SourceText == "" {
		t.Fatal("the draft dropped the source text, so a retry would need a re-upload")
	}
	if draft.Slug != "arun-velasco" {
		t.Fatalf("slug = %q", draft.Slug)
	}
	if draft.Chips == nil || draft.Quiz == nil || draft.Sections == nil ||
		draft.PreRoll.Bullets == nil {
		t.Fatalf("empty collections must serialize as [] not null: %+v", draft)
	}
}

func TestIngestFailureKeepsTheDraft(t *testing.T) {
	draft := fixtureKB()

	failed := MarkIngestFailed(draft, "The pipeline did not answer within 180s.")

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

func TestApplyIngestResultNumbersSectionsTheServerWay(t *testing.T) {
	draft := NewDraft(
		"kb-1", api.User{ID: "user-arun"},
		api.IngestRequest{Title: "T", Tagline: "t", SourceText: "s"},
		"2026-08-26T10:00:00Z",
	)
	result := api.IngestResult{
		// The pipeline omitted every ordinal, which it is allowed to do.
		Sections: []api.Section{{Path: "a", Title: "one"}, {Path: "b", Title: "two"}},
		Chips:    []api.Chip{{Text: "c"}},
		Quiz:     quizWithEveryCategory(),
	}

	ready := ApplyIngestResult(draft, result)

	if ready.IngestStatus != api.IngestReady {
		t.Fatalf("ingest_status = %q", ready.IngestStatus)
	}
	if ready.Sections[0].Ord != 1 || ready.Sections[1].Ord != 2 {
		t.Fatalf("ordinals = %+v", ready.Sections)
	}
}

func TestSectionIDJoinsTheSameWayEverywhere(t *testing.T) {
	// A twin of section_id() in Python and sectionId() in TypeScript. Reference
	// resolution is an equality test on this, so an inconsistent join breaks all of it.
	cases := []struct{ path, anchor, want string }{
		{"agoda/psp-routing", "circuit-breakers", "agoda/psp-routing#circuit-breakers"},
		{"postgres/opinions", "", "postgres/opinions"},
		{"/postgres/opinions/", "#deferred", "postgres/opinions#deferred"},
		{" career/timeline ", " overview ", "career/timeline#overview"},
	}

	for _, testCase := range cases {
		if got := api.SectionID(testCase.path, testCase.anchor); got != testCase.want {
			t.Errorf(
				"SectionID(%q, %q) = %q, want %q",
				testCase.path, testCase.anchor, got, testCase.want,
			)
		}
	}
}

func TestSlugify(t *testing.T) {
	cases := []struct{ input, want string }{
		{"Arun Velasco", "arun-velasco"},
		{"  Spaces   Everywhere  ", "spaces-everywhere"},
		{"José Álvarez", "jose-alvarez"},
		{"Priya R. — 2nd account!", "priya-r-2nd-account"},
		{"—— ——", "candidate"},
		{"", "candidate"},
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
