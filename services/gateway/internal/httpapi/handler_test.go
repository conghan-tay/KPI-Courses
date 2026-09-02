package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/example/reverse-interview/services/gateway/internal/api"
	"github.com/example/reverse-interview/services/gateway/internal/kb"
	"github.com/example/reverse-interview/services/gateway/internal/store"
)

// ── fakes ────────────────────────────────────────────────────────────────────

// fakeStore is an in-memory Repository. It is guarded by a mutex because the ingestion
// watcher writes from its own goroutine while the stream reads from the request's.
type fakeStore struct {
	mu        sync.Mutex
	stored    map[string]api.KnowledgeBase
	users     map[string]api.User
	created   []api.KnowledgeBase
	returnErr error
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		stored: map[string]api.KnowledgeBase{},
		users: map[string]api.User{
			"user-arun":  {ID: "user-arun", Name: "Arun Velasco", Role: api.RoleCandidate},
			"user-priya": {ID: "user-priya", Name: "Priya Raman", Role: api.RoleRecruiter},
		},
	}
}

func (s *fakeStore) List(
	_ context.Context, candidateID string,
) ([]api.KnowledgeBase, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.returnErr != nil {
		return nil, s.returnErr
	}
	out := []api.KnowledgeBase{}
	for _, knowledgeBase := range s.stored {
		if knowledgeBase.CandidateID == candidateID {
			out = append(out, knowledgeBase)
		}
	}
	return out, nil
}

func (s *fakeStore) Get(_ context.Context, id string) (api.KnowledgeBase, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.returnErr != nil {
		return api.KnowledgeBase{}, s.returnErr
	}
	knowledgeBase, ok := s.stored[id]
	if !ok {
		return api.KnowledgeBase{}, store.ErrNotFound
	}
	return knowledgeBase, nil
}

func (s *fakeStore) GetBySlug(_ context.Context, slug string) (api.KnowledgeBase, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, knowledgeBase := range s.stored {
		if knowledgeBase.Slug == slug {
			return knowledgeBase, nil
		}
	}
	return api.KnowledgeBase{}, store.ErrNotFound
}

func (s *fakeStore) Create(
	_ context.Context, knowledgeBase api.KnowledgeBase,
) (api.KnowledgeBase, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.returnErr != nil {
		return api.KnowledgeBase{}, s.returnErr
	}
	s.stored[knowledgeBase.ID] = knowledgeBase
	s.created = append(s.created, knowledgeBase)
	return knowledgeBase, nil
}

func (s *fakeStore) Update(
	_ context.Context, id string, mutate func(api.KnowledgeBase) api.KnowledgeBase,
) (api.KnowledgeBase, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, ok := s.stored[id]
	if !ok {
		return api.KnowledgeBase{}, store.ErrNotFound
	}
	updated := mutate(current)
	updated.ID = current.ID
	s.stored[id] = updated
	return updated, nil
}

func (s *fakeStore) ListRunning(context.Context) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ids := []string{}
	for id, knowledgeBase := range s.stored {
		if knowledgeBase.IngestStatus == api.IngestRunning {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func (s *fakeStore) User(_ context.Context, id string) (api.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.users[id]
	if !ok {
		return api.User{}, store.ErrUnknownUser
	}
	return user, nil
}

func (s *fakeStore) put(knowledgeBase api.KnowledgeBase) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stored[knowledgeBase.ID] = knowledgeBase
}

func (s *fakeStore) snapshot(id string) api.KnowledgeBase {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stored[id]
}

func (s *fakeStore) createdCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.created)
}

// fakeRuntime stands in for Temporal. `result` and `runErr` decide how a run ends;
// `lines` is what the progress query reports.
type fakeRuntime struct {
	mu            sync.Mutex
	started       []kb.IngestionInput
	lines         []string
	result        api.IngestResult
	runErr        error
	rephrased     string
	rephraseErr   error
	rephraseSeen  string
	registerSeen  string
	rephraseCalls int
}

func (f *fakeRuntime) StartIngestion(_ context.Context, input kb.IngestionInput) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.started = append(f.started, input)
	return nil
}

func (f *fakeRuntime) Progress(context.Context, string) (api.IngestProgress, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return api.IngestProgress{Status: api.ProgressRunning, Lines: f.lines}, nil
}

func (f *fakeRuntime) AwaitResult(context.Context, string) (api.IngestResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.runErr != nil {
		return api.IngestResult{}, f.runErr
	}
	return f.result, nil
}

func (f *fakeRuntime) RephraseChip(
	_ context.Context, text, register string,
) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rephraseSeen = text
	f.registerSeen = register
	f.rephraseCalls++
	return f.rephrased, f.rephraseErr
}

func (f *fakeRuntime) startedRuns() []kb.IngestionInput {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]kb.IngestionInput(nil), f.started...)
}

type fakeKnowledge struct {
	documents []api.KnowledgeDocument
	returnErr error
}

func (f *fakeKnowledge) Upsert(
	_ context.Context, documents []api.KnowledgeDocument,
) (int, error) {
	f.documents = documents
	if f.returnErr != nil {
		return 0, f.returnErr
	}
	return len(documents), nil
}

// recordingLimiter captures the keys it was asked about so tests can assert both that
// the limiter ran and what it was keyed on.
type recordingLimiter struct {
	keys      []string
	allow     bool
	returnErr error
}

func (l *recordingLimiter) Allow(_ context.Context, key string) (bool, error) {
	l.keys = append(l.keys, key)
	if l.returnErr != nil {
		return false, l.returnErr
	}
	return l.allow, nil
}

// ── harness ──────────────────────────────────────────────────────────────────

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

type harness struct {
	handler   http.Handler
	store     *fakeStore
	runtime   *fakeRuntime
	knowledge *fakeKnowledge
}

func newHarness(t *testing.T, options ...func(*harness)) *harness {
	t.Helper()
	h := &harness{
		store:     newFakeStore(),
		runtime:   &fakeRuntime{},
		knowledge: &fakeKnowledge{},
	}
	for _, apply := range options {
		apply(h)
	}
	h.handler = New(Options{
		APIKey:     "secret",
		Repository: h.store,
		Ingestor: kb.NewIngestor(kb.IngestorOptions{
			Repository: h.store,
			Runtime:    h.runtime,
			Logger:     discardLogger(),
			NewID:      func() string { return "kb-test" },
			MaxStream:  5 * time.Second,
		}),
		Runtime:   h.runtime,
		Knowledge: h.knowledge,
		Logger:    discardLogger(),
		Timeout:   time.Second,
	})
	return h
}

func newLimitedHandler(limiter RateLimiter) http.Handler {
	fake := newFakeStore()
	runtime := &fakeRuntime{}
	return New(Options{
		APIKey:     "secret",
		Repository: fake,
		Runtime:    runtime,
		Ingestor: kb.NewIngestor(kb.IngestorOptions{
			Repository: fake, Runtime: runtime, Logger: discardLogger(),
		}),
		Knowledge: &fakeKnowledge{},
		Limiter:   limiter,
		Logger:    discardLogger(),
		Timeout:   time.Second,
	})
}

// do issues an authenticated request as Arun, the seeded candidate.
func do(handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
	return doAs(handler, method, target, body, "user-arun")
}

func doAs(
	handler http.Handler, method, target, body, candidateID string,
) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, target, reader)
	request.Header.Set("X-API-Key", "secret")
	if candidateID != "" {
		request.Header.Set(candidateHeader, candidateID)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func readyKB(id, candidateID string) api.KnowledgeBase {
	knowledgeBase := api.KnowledgeBase{
		ID: id, CandidateID: candidateID, CandidateName: "Arun Velasco",
		Slug: "arun-velasco", Title: "Arun Velasco",
		Tagline: "Payments engineer. Eleven years, four employers, one gap.",
		Status:  api.StatusDraft, IngestStatus: api.IngestReady,
		PreRoll: api.PreRoll{
			Headline: "Sixty minutes. Starts when you hit send.",
			Bullets:  []string{"Full timeline, four employers, gap included"},
		},
		Chips: []api.Chip{
			{
				Text: "why did he leave agoda?", KBSection: "career/timeline#agoda-exit",
				Register: api.RegisterBlunt, Selected: true,
				WhyItLands: "Every recruiter asks it eventually.",
			},
			{
				Text: "how deep is his postgres actually?", KBSection: "postgres/opinions",
				Register: api.RegisterSkeptical, Selected: true,
			},
			{
				Text: "walk me through the payouts flow", KBSection: "postgres/opinions",
				Register: api.RegisterNarrative, Selected: true,
			},
		},
		Quiz: quizWithEveryCategory(),
		Sections: []api.Section{
			{
				Ord: 1, Path: "career/timeline", Anchor: "agoda-exit",
				Title: "Why he left Agoda", Summary: "One paragraph, no wandering.",
				BodyMD: "The platform reached the state he wanted.",
			},
			{
				Ord: 2, Path: "postgres/opinions", Title: "Postgres opinions",
				Summary: "Six stated positions.",
				BodyMD:  "A queue in your database is the correct default.",
			},
		},
		SourceText: "the whole corpus",
		CreatedAt:  "2026-08-26T10:00:00Z", UpdatedAt: "2026-08-26T10:00:00Z",
	}
	knowledgeBase.Normalize()
	return knowledgeBase
}

// A quiz that satisfies the gate: one item in every category it samples from.
func quizWithEveryCategory() []api.QuizItem {
	categories := []string{
		api.CategoryMotivation, api.CategoryJudgement,
		api.CategoryLimits, api.CategorySubstance,
	}
	items := make([]api.QuizItem, 0, len(categories))
	for index, category := range categories {
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

// withKB seeds one knowledge base owned by Arun.
func withKB(mutate ...func(*api.KnowledgeBase)) func(*harness) {
	return func(h *harness) {
		knowledgeBase := readyKB("kb-1", "user-arun")
		for _, apply := range mutate {
			apply(&knowledgeBase)
		}
		h.store.put(knowledgeBase)
	}
}

func decodeError(t *testing.T, recorder *httptest.ResponseRecorder) errorEnvelope {
	t.Helper()
	var body struct {
		Error errorEnvelope `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error envelope from %s: %v", recorder.Body.String(), err)
	}
	return body.Error
}

func longSource() string { return strings.Repeat("corpus ", 60) }

// ── authentication and rate limiting ─────────────────────────────────────────

func TestAuthenticationIsRequired(t *testing.T) {
	h := newHarness(t)
	recorder := httptest.NewRecorder()

	h.handler.ServeHTTP(
		recorder, httptest.NewRequest(http.MethodGet, "/v1/knowledge-bases", nil),
	)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}

// The API key proves the caller is the web app; the candidate header says who is signed
// in. A valid key naming an identity nobody seeded is not a candidate.
func TestAnUnknownCandidateIsRejected(t *testing.T) {
	h := newHarness(t)

	for _, id := range []string{"", "user-nobody", "../admin"} {
		recorder := doAs(h.handler, http.MethodGet, "/v1/knowledge-bases", "", id)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("candidate %q: status = %d, want 401", id, recorder.Code)
		}
		if code := decodeError(t, recorder).Code; code != "unknown_user" {
			t.Fatalf("candidate %q: code = %q", id, code)
		}
	}
}

func TestHealthzDoesNotRequireAuthentication(t *testing.T) {
	h := newHarness(t)
	recorder := httptest.NewRecorder()

	h.handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
}

func TestRequestsThatFailAuthenticationStillConsumeRateLimitBudget(t *testing.T) {
	limiter := &recordingLimiter{allow: true}
	handler := newLimitedHandler(limiter)
	request := httptest.NewRequest(http.MethodGet, "/v1/knowledge-bases", nil)
	request.Header.Set("X-API-Key", "wrong-key")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	// Without this, guessing the API key is free: the counter is never incremented, so
	// there is neither a limit to hit nor a number anyone could alert on.
	if len(limiter.keys) != 1 {
		t.Fatalf("limiter consulted %d times, want 1", len(limiter.keys))
	}
}

func TestExhaustedRateLimitIsRejectedBeforeTheKeyCheck(t *testing.T) {
	handler := newLimitedHandler(&recordingLimiter{allow: false})
	request := httptest.NewRequest(http.MethodGet, "/v1/knowledge-bases", nil)
	request.Header.Set("X-API-Key", "wrong-key")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusTooManyRequests)
	}
}

func TestHealthRoutesAreNotRateLimited(t *testing.T) {
	limiter := &recordingLimiter{allow: false}
	handler := newLimitedHandler(limiter)

	for _, path := range []string{"/healthz", "/readyz"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want %d", path, recorder.Code, http.StatusOK)
		}
	}
	if len(limiter.keys) != 0 {
		t.Fatalf("health routes consulted the limiter: %v", limiter.keys)
	}
}

func TestRateLimiterOutageFailsOpen(t *testing.T) {
	handler := newLimitedHandler(&recordingLimiter{returnErr: errors.New("redis is down")})

	recorder := do(handler, http.MethodGet, "/v1/knowledge-bases", "")

	// A Redis outage must not take down the studio, so the request is served anyway.
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestRateLimitKeyIdentifiesEachClientAddress(t *testing.T) {
	cases := []struct {
		name       string
		remoteAddr string
		forwarded  string
		want       string
	}{
		{name: "ipv4", remoteAddr: "192.0.2.5:54321", want: "192.0.2.5"},
		// Cutting at the first colon returned "[" for every one of these, so all IPv6
		// clients shared a single bucket.
		{name: "ipv6", remoteAddr: "[2001:db8::1]:54321", want: "2001:db8::1"},
		{name: "ipv6 loopback", remoteAddr: "[::1]:8080", want: "::1"},
		{name: "ipv6 with zone", remoteAddr: "[fe80::1%eth0]:9000", want: "fe80::1%eth0"},
		{name: "address without a port", remoteAddr: "192.0.2.9", want: "192.0.2.9"},
		{
			name:       "forwarded address wins",
			remoteAddr: "192.0.2.5:54321",
			forwarded:  "2001:db8::99, 198.51.100.7",
			want:       "2001:db8::99",
		},
		{
			name:       "unparseable forwarded address falls back to the peer",
			remoteAddr: "[2001:db8::2]:1234",
			forwarded:  "not-an-ip",
			want:       "2001:db8::2",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/v1/knowledge-bases", nil)
			request.RemoteAddr = testCase.remoteAddr
			if testCase.forwarded != "" {
				request.Header.Set("X-Forwarded-For", testCase.forwarded)
			}

			if key := rateLimitKey(request); key != testCase.want {
				t.Fatalf("key = %q, want %q", key, testCase.want)
			}
		})
	}
}

// ── ownership ────────────────────────────────────────────────────────────────

func TestAnotherUsersKnowledgeBaseIsRefused(t *testing.T) {
	h := newHarness(t, withKB())

	cases := []struct{ method, target string }{
		{http.MethodGet, "/v1/knowledge-bases/kb-1"},
		{http.MethodPost, "/v1/knowledge-bases/kb-1/publish"},
		{http.MethodPost, "/v1/knowledge-bases/kb-1/reingest"},
		{http.MethodPost, "/v1/knowledge-bases/kb-1/chips/0/rephrase"},
	}
	for _, testCase := range cases {
		recorder := doAs(h.handler, testCase.method, testCase.target, "", "user-priya")
		if recorder.Code != http.StatusForbidden {
			t.Errorf(
				"%s %s: status = %d, want 403",
				testCase.method, testCase.target, recorder.Code,
			)
		}
	}
	if h.store.snapshot("kb-1").Status == api.StatusPublished {
		t.Fatal("somebody else's knowledge base was published")
	}
}

func TestUnknownKnowledgeBaseIsNotFound(t *testing.T) {
	h := newHarness(t)

	recorder := do(h.handler, http.MethodGet, "/v1/knowledge-bases/kb-missing", "")

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
	}
}

func TestIDsWithPathSeparatorsAreRejected(t *testing.T) {
	h := newHarness(t)

	recorder := do(h.handler, http.MethodGet, "/v1/knowledge-bases/..%2Fadmin", "")

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}

// ── the withholding rule ─────────────────────────────────────────────────────

// Asserted at the edge. The public projection is unauthenticated by design — Journey 2's
// /k/:slug page has no session — and the quiz must not be in it at any cost: it gates
// booking real time, and a leaked correct_index makes that gate a formality.
func TestPublicAudienceNeedsNoIdentityAndWithholdsTheQuiz(t *testing.T) {
	h := newHarness(t, withKB())

	recorder := doAs(
		h.handler, http.MethodGet, "/v1/knowledge-bases/kb-1?audience=public", "", "",
	)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	for _, forbidden := range []string{
		"quiz", "correct_index", "choices", "rationale",
		"why_it_lands", "body_md", "source_text", "kb_section",
		"Every recruiter asks it eventually", "the whole corpus",
		"A queue in your database is the correct default",
	} {
		if strings.Contains(body, forbidden) {
			t.Errorf("public payload leaked %q: %s", forbidden, body)
		}
	}
	if !strings.Contains(body, "why did he leave agoda?") {
		t.Fatalf("public payload dropped the chips, which are the page: %s", body)
	}
}

// ── patch, publish, rephrase ─────────────────────────────────────────────────

func TestPatchAppliesOnlyWhatWasSentAndRenumbers(t *testing.T) {
	h := newHarness(t, withKB())

	recorder := do(h.handler, http.MethodPatch, "/v1/knowledge-bases/kb-1",
		`{"sections":[{"ord":9,"path":"b","title":"b"},{"ord":4,"path":"a","title":"a"}]}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	saved := h.store.snapshot("kb-1")
	if saved.Sections[0].Ord != 1 || saved.Sections[1].Ord != 2 {
		t.Fatalf("ordinals = %+v", saved.Sections)
	}
	if saved.Title != "Arun Velasco" {
		t.Fatalf("a sections-only patch changed the title: %q", saved.Title)
	}
	if len(saved.Quiz) != 4 {
		t.Fatalf("a sections-only patch dropped the quiz: %+v", saved.Quiz)
	}
}

func TestPatchRejectsBadEdits(t *testing.T) {
	cases := []struct{ name, body, want string }{
		{name: "nothing to change", body: `{}`, want: "patch"},
		{name: "blank title", body: `{"title":"   "}`, want: "title"},
		{
			name: "section without a title",
			body: `{"sections":[{"ord":1,"path":"a","title":""}]}`,
			want: "sections[0].title",
		},
		{
			// Two sections sharing an id turn every reference to it into a coin flip.
			name: "two sections with the same id",
			body: `{"sections":[` +
				`{"ord":1,"path":"a","anchor":"x","title":"one"},` +
				`{"ord":2,"path":"a","anchor":"x","title":"two"}]}`,
			want: "duplicates another section's id",
		},
		{
			name: "chip without text",
			body: `{"chips":[{"text":"","kb_section":"a"}]}`,
			want: "chips[0].text",
		},
		{
			name: "chip in a register nobody renders",
			body: `{"chips":[{"text":"a question","register":"wry"}]}`,
			want: "chips[0].register",
		},
		{
			// The gate renders four options and scores one. Three is a broken screen.
			name: "quiz item with three options",
			body: `{"quiz":[{"question":"q","category":"limits",` +
				`"choices":["a","b","c"],"correct_index":0}]}`,
			want: "quiz[0].choices",
		},
		{
			name: "quiz answer that points at no option",
			body: `{"quiz":[{"question":"q","category":"limits",` +
				`"choices":["a","b","c","d"],"correct_index":9}]}`,
			want: "quiz[0].correct_index",
		},
		{
			name: "pre-roll with five bullets",
			body: `{"pre_roll":{"headline":"h","bullets":["a","b","c","d","e"]}}`,
			want: "pre_roll.bullets",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			h := newHarness(t, withKB())

			recorder := do(
				h.handler, http.MethodPatch, "/v1/knowledge-bases/kb-1", testCase.body,
			)

			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if !strings.Contains(recorder.Body.String(), testCase.want) {
				t.Fatalf(
					"body = %s, want mention of %q", recorder.Body.String(), testCase.want,
				)
			}
		})
	}
}

func TestPublishReturnsTheShareableLink(t *testing.T) {
	h := newHarness(t, withKB())

	recorder := do(h.handler, http.MethodPost, "/v1/knowledge-bases/kb-1/publish", "")

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		URL           string            `json:"url"`
		KnowledgeBase api.KnowledgeBase `json:"knowledge_base"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.URL != "/k/arun-velasco" {
		t.Fatalf("url = %q", response.URL)
	}
	if response.KnowledgeBase.Status != api.StatusPublished {
		t.Fatalf("status = %q", response.KnowledgeBase.Status)
	}
}

func TestPublishReportsEveryBlockerAtOnce(t *testing.T) {
	h := newHarness(t, withKB(func(k *api.KnowledgeBase) {
		k.Tagline = ""
		k.Chips[0].Selected = false
	}))

	recorder := do(h.handler, http.MethodPost, "/v1/knowledge-bases/kb-1/publish", "")

	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	envelope := decodeError(t, recorder)
	if envelope.Code != "not_publishable" {
		t.Fatalf("code = %q", envelope.Code)
	}
	// One round trip, every problem: a dialog that reveals blockers one at a time is a
	// dialog nobody finishes.
	if len(envelope.Blockers) != 2 {
		t.Fatalf("blockers = %v, want both the tagline and the selection", envelope.Blockers)
	}
	if h.store.snapshot("kb-1").Status == api.StatusPublished {
		t.Fatal("a blocked knowledge base was published anyway")
	}
}

// A candidate with a sparse corpus still has something worth publishing.
func TestAThinKnowledgeBaseStillPublishes(t *testing.T) {
	h := newHarness(t, withKB(func(k *api.KnowledgeBase) {
		k.Sections = k.Sections[:1]
	}))

	recorder := do(h.handler, http.MethodPost, "/v1/knowledge-bases/kb-1/publish", "")

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestRephraseRewritesTheChipInPlace(t *testing.T) {
	h := newHarness(t, withKB(), func(h *harness) {
		h.runtime.rephrased = "why did he actually leave agoda?"
	})

	recorder := do(
		h.handler, http.MethodPost,
		"/v1/knowledge-bases/kb-1/chips/0/rephrase?register=skeptical", "",
	)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if h.runtime.registerSeen != api.RegisterSkeptical {
		t.Fatalf("register = %q, want the one the caller asked for", h.runtime.registerSeen)
	}
	saved := h.store.snapshot("kb-1")
	if saved.Chips[0].Text != "why did he actually leave agoda?" {
		t.Fatalf("text = %q", saved.Chips[0].Text)
	}
	if saved.Chips[0].Register != api.RegisterSkeptical {
		t.Fatalf("the stored register did not follow the rewrite: %q", saved.Chips[0].Register)
	}
	// Rewriting the question must not disturb what the candidate decided about it.
	if !saved.Chips[0].Selected || saved.Chips[0].KBSection != "career/timeline#agoda-exit" {
		t.Fatalf("rephrase changed more than the text: %+v", saved.Chips[0])
	}
}

func TestRephraseWithoutARegisterKeepsTheChipsOwn(t *testing.T) {
	h := newHarness(t, withKB(), func(h *harness) {
		h.runtime.rephrased = "why did he leave, really?"
	})

	do(h.handler, http.MethodPost, "/v1/knowledge-bases/kb-1/chips/0/rephrase", "")

	if h.runtime.registerSeen != api.RegisterBlunt {
		t.Fatalf("register = %q, want the chip's own", h.runtime.registerSeen)
	}
}

func TestRephrasingAChipThatIsNotThereIsNotFound(t *testing.T) {
	h := newHarness(t, withKB())

	for _, index := range []string{"7", "-1", "banana"} {
		recorder := do(
			h.handler, http.MethodPost,
			"/v1/knowledge-bases/kb-1/chips/"+index+"/rephrase", "",
		)
		if recorder.Code != http.StatusNotFound {
			t.Errorf("index %q: status = %d, want 404", index, recorder.Code)
		}
	}
	if h.runtime.rephraseCalls != 0 {
		t.Fatal("a bad index still reached the model")
	}
}

func TestRephraseFailureLeavesTheChipAlone(t *testing.T) {
	h := newHarness(t, withKB(), func(h *harness) {
		h.runtime.rephraseErr = errors.New("no model configured")
	})

	recorder := do(h.handler, http.MethodPost, "/v1/knowledge-bases/kb-1/chips/0/rephrase", "")

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "no model configured") {
		t.Fatalf("upstream detail leaked: %s", recorder.Body.String())
	}
	if h.store.snapshot("kb-1").Chips[0].Text != "why did he leave agoda?" {
		t.Fatal("a failed rewrite changed the question")
	}
}

// ── ingestion ────────────────────────────────────────────────────────────────

func TestIngestValidationRunsBeforeADraftIsWritten(t *testing.T) {
	cases := []struct{ name, body, want string }{
		{
			name: "no name",
			body: `{"tagline":"t","source_text":"` + longSource() + `"}`,
			want: "title",
		},
		{
			name: "no one-liner",
			body: `{"title":"T","source_text":"` + longSource() + `"}`,
			want: "tagline",
		},
		{
			name: "not enough material",
			body: `{"title":"T","tagline":"t","source_text":"too short"}`,
			want: "source_text",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			h := newHarness(t)

			recorder := do(
				h.handler, http.MethodPost, "/v1/knowledge-bases/ingest", testCase.body,
			)

			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if !strings.Contains(recorder.Body.String(), testCase.want) {
				t.Fatalf(
					"body = %s, want mention of %q", recorder.Body.String(), testCase.want,
				)
			}
			if h.store.createdCount() != 0 {
				t.Fatal("an invalid request still wrote a draft")
			}
			if len(h.runtime.startedRuns()) != 0 {
				t.Fatal("an invalid request still started a workflow")
			}
		})
	}
}

// The happy path, asserted on the wire: frames arrive in the order
// services/web/lib/api-client.ts parses them, and `draft` comes first so a client that
// sees nothing else still knows what to retry.
func TestIngestStreamsDraftThenStatusThenResult(t *testing.T) {
	h := newHarness(t, func(h *harness) {
		h.runtime.lines = []string{
			"READING 1 OF 1 FILES · resume.md", "DRAFTING OPENING QUESTIONS…",
		}
		h.runtime.result = api.IngestResult{
			Sections: []api.Section{{Path: "a", Title: "one"}, {Path: "b", Title: "two"}},
			Chips:    []api.Chip{{Text: "a question"}},
			Quiz:     quizWithEveryCategory(),
		}
	})

	recorder := do(h.handler, http.MethodPost, "/v1/knowledge-bases/ingest",
		`{"title":"Arun Velasco","tagline":"t","source_text":"`+
			longSource()+`","source_files":["resume.md"]}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if contentType := recorder.Header().Get("Content-Type"); !strings.HasPrefix(
		contentType, "text/event-stream",
	) {
		t.Fatalf("content-type = %q", contentType)
	}

	events := parseEvents(t, recorder.Body.String())
	if len(events) < 4 {
		t.Fatalf("events = %+v", events)
	}
	if events[0].Type != "draft" || events[0].KBID != "kb-test" {
		t.Fatalf("first event = %+v, want the draft id before anything can fail", events[0])
	}
	if events[1].Type != "status" || events[2].Type != "status" {
		t.Fatalf("status lines = %+v", events[1:3])
	}
	last := events[len(events)-1]
	if last.Type != "result" || last.KBID != "kb-test" {
		t.Fatalf("last event = %+v", last)
	}

	// The result is persisted by the watcher, not by the stream. "result" must not go
	// out until that has landed, or the client navigates to an empty review screen.
	saved := h.store.snapshot("kb-test")
	if saved.IngestStatus != api.IngestReady || len(saved.Sections) != 2 {
		t.Fatalf("saved knowledge base = %+v", saved)
	}
	if saved.Sections[0].Ord != 1 || saved.Sections[1].Ord != 2 {
		t.Fatalf("ordinals were not assigned: %+v", saved.Sections)
	}
	if len(saved.Quiz) != 4 {
		t.Fatalf("the quiz did not survive persistence: %+v", saved.Quiz)
	}
}

// A status line is only ever sent once, however many times the query is polled.
func TestStatusLinesAreNotRepeated(t *testing.T) {
	h := newHarness(t, func(h *harness) {
		h.runtime.lines = []string{"READING…", "WRITING SECTION 1 OF 2…"}
		h.runtime.result = api.IngestResult{Sections: []api.Section{{Path: "a", Title: "one"}}}
	})

	recorder := do(h.handler, http.MethodPost, "/v1/knowledge-bases/ingest",
		`{"title":"T","tagline":"t","source_text":"`+longSource()+`"}`)

	seen := map[string]int{}
	for _, event := range parseEvents(t, recorder.Body.String()) {
		if event.Type == "status" {
			seen[event.Message]++
		}
	}
	for message, count := range seen {
		if count != 1 {
			t.Fatalf("status %q was sent %d times", message, count)
		}
	}
}

// "ingestion timeout → keep the draft, offer retry". The draft must survive with its
// source text intact, or [RETRY INGESTION] has nothing to run on.
func TestAFailedRunLeavesARetryableDraft(t *testing.T) {
	h := newHarness(t, func(h *harness) {
		h.runtime.runErr = errors.New("worker is down")
	})

	recorder := do(h.handler, http.MethodPost, "/v1/knowledge-bases/ingest",
		`{"title":"Arun Velasco","tagline":"t","source_text":"`+longSource()+`"}`)

	events := parseEvents(t, recorder.Body.String())
	last := events[len(events)-1]
	if last.Type != "error" || last.Code != "ingest_failed" || last.KBID != "kb-test" {
		t.Fatalf("last event = %+v", last)
	}
	// Infrastructure detail must not reach the person who dropped the files.
	if strings.Contains(recorder.Body.String(), "worker is down") {
		t.Fatalf("upstream detail leaked: %s", recorder.Body.String())
	}

	saved := h.store.snapshot("kb-test")
	if saved.IngestStatus != api.IngestFailed {
		t.Fatalf("ingest_status = %q", saved.IngestStatus)
	}
	if saved.SourceText == "" {
		t.Fatal("the failed draft lost its source text, so a retry would need a re-upload")
	}
	if saved.IngestError == "" {
		t.Fatal("the failed draft has no message to show on the review screen")
	}
}

func TestReingestReusesTheStoredSourceText(t *testing.T) {
	h := newHarness(t,
		withKB(func(k *api.KnowledgeBase) {
			k.IngestStatus = api.IngestFailed
			k.IngestError = "The pipeline did not answer in time."
		}),
		func(h *harness) {
			h.runtime.result = api.IngestResult{
				Sections: []api.Section{{Path: "a", Title: "recovered"}},
			}
		},
	)

	recorder := do(h.handler, http.MethodPost, "/v1/knowledge-bases/kb-1/reingest", "")

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	started := h.runtime.startedRuns()
	if len(started) != 1 {
		t.Fatalf("started %d runs, want 1", len(started))
	}
	// The whole reason the draft is written before the pipeline runs: a retry never asks
	// the candidate to find their files again.
	if started[0].SourceText != "the whole corpus" {
		t.Fatalf("retry sent %q as the corpus", started[0].SourceText)
	}
	saved := h.store.snapshot("kb-1")
	if saved.IngestStatus != api.IngestReady || saved.IngestError != "" {
		t.Fatalf("saved knowledge base = %+v", saved)
	}
}

func TestReingestWithoutSourceMaterialIsAConflict(t *testing.T) {
	h := newHarness(t, withKB(func(k *api.KnowledgeBase) { k.SourceText = "" }))

	recorder := do(h.handler, http.MethodPost, "/v1/knowledge-bases/kb-1/reingest", "")

	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusConflict)
	}
	if len(h.runtime.startedRuns()) != 0 {
		t.Fatal("a run was started with nothing to ingest")
	}
}

// The watcher runs on its own context so a closed tab cannot lose a finished knowledge
// base. Reconcile is what covers the same case across a restart.
func TestReconcileReattachesToInFlightRuns(t *testing.T) {
	fake := newFakeStore()
	running := readyKB("kb-1", "user-arun")
	running.IngestStatus = api.IngestRunning
	running.Sections = nil
	fake.put(running)

	runtime := &fakeRuntime{result: api.IngestResult{
		Sections: []api.Section{{Path: "a", Title: "one"}},
	}}
	ingestor := kb.NewIngestor(kb.IngestorOptions{
		Repository: fake, Runtime: runtime, Logger: discardLogger(),
		MaxStream: 5 * time.Second,
	})

	if err := ingestor.Reconcile(context.Background()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if fake.snapshot("kb-1").IngestStatus == api.IngestReady {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("left in %q after reconcile", fake.snapshot("kb-1").IngestStatus)
}

func parseEvents(t *testing.T, body string) []api.IngestEvent {
	t.Helper()
	events := []api.IngestEvent{}
	for _, line := range strings.Split(body, "\n") {
		payload, found := strings.CutPrefix(line, "data: ")
		if !found {
			continue
		}
		var event api.IngestEvent
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			t.Fatalf("decode event %q: %v", payload, err)
		}
		events = append(events, event)
	}
	return events
}

// ── vectors (retained from the reference application) ────────────────────────

func TestVectorUpsertReportsCount(t *testing.T) {
	h := newHarness(t)

	recorder := do(h.handler, http.MethodPost, "/v1/vectors",
		`{"documents":[{"id":"a","title":"A","content":"body","source":"a"}]}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response api.VectorUpsertResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Upserted != 1 {
		t.Fatalf("upserted = %d, want 1", response.Upserted)
	}
}

func TestMalformedJSONIsRejectedBeforeAnyDependency(t *testing.T) {
	h := newHarness(t)

	recorder := do(h.handler, http.MethodPost, "/v1/vectors", `{"documents":`)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	if h.knowledge.documents != nil {
		t.Fatal("invalid request reached the vector store")
	}
}

func TestVectorValidationRejectsBadDocuments(t *testing.T) {
	cases := []struct{ name, body, want string }{
		{name: "empty list", body: `{"documents":[]}`, want: "documents"},
		{
			name: "document missing content",
			body: `{"documents":[{"id":"a","title":"A","content":"","source":"a"}]}`,
			want: "documents[0].content",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			h := newHarness(t)

			recorder := do(h.handler, http.MethodPost, "/v1/vectors", testCase.body)

			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if !strings.Contains(recorder.Body.String(), testCase.want) {
				t.Fatalf(
					"body = %s, want mention of %q", recorder.Body.String(), testCase.want,
				)
			}
			if h.knowledge.documents != nil {
				t.Fatal("invalid request reached the vector store")
			}
		})
	}
}

func TestUpstreamFailureIsABadGateway(t *testing.T) {
	h := newHarness(t, func(h *harness) {
		h.store.returnErr = errors.New("connection refused")
	})

	recorder := do(h.handler, http.MethodGet, "/v1/knowledge-bases", "")

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadGateway)
	}
	// The upstream error text must not leak to the caller.
	if strings.Contains(recorder.Body.String(), "connection refused") {
		t.Fatalf("body leaked upstream detail: %s", recorder.Body.String())
	}
}

func TestTimeoutIsAGatewayTimeout(t *testing.T) {
	h := newHarness(t, func(h *harness) {
		h.store.returnErr = context.DeadlineExceeded
	})

	recorder := do(h.handler, http.MethodGet, "/v1/knowledge-bases", "")

	if recorder.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusGatewayTimeout)
	}
}
