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

	"github.com/example/kpi-courses/services/gateway/internal/api"
	"github.com/example/kpi-courses/services/gateway/internal/courses"
	"github.com/example/kpi-courses/services/gateway/internal/store"
)

// ── fakes ────────────────────────────────────────────────────────────────────

// fakeStore is an in-memory Repository. It is guarded by a mutex because the ingestion
// watcher writes from its own goroutine while the stream reads from the request's.
type fakeStore struct {
	mu        sync.Mutex
	courses   map[string]api.Course
	users     map[string]api.User
	created   []api.Course
	returnErr error
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		courses: map[string]api.Course{},
		users: map[string]api.User{
			"user-dana": {ID: "user-dana", Name: "Dana Mercado", Role: api.RoleSpecialist},
			"user-sam":  {ID: "user-sam", Name: "Sam Okonkwo", Role: api.RoleSeeker},
		},
	}
}

func (s *fakeStore) List(_ context.Context, specialistID string) ([]api.Course, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.returnErr != nil {
		return nil, s.returnErr
	}
	out := []api.Course{}
	for _, course := range s.courses {
		if course.SpecialistID == specialistID {
			out = append(out, course)
		}
	}
	return out, nil
}

func (s *fakeStore) Get(_ context.Context, id string) (api.Course, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.returnErr != nil {
		return api.Course{}, s.returnErr
	}
	course, ok := s.courses[id]
	if !ok {
		return api.Course{}, store.ErrNotFound
	}
	return course, nil
}

func (s *fakeStore) GetBySlug(_ context.Context, slug string) (api.Course, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, course := range s.courses {
		if course.Slug == slug {
			return course, nil
		}
	}
	return api.Course{}, store.ErrNotFound
}

func (s *fakeStore) Create(_ context.Context, course api.Course) (api.Course, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.returnErr != nil {
		return api.Course{}, s.returnErr
	}
	s.courses[course.ID] = course
	s.created = append(s.created, course)
	return course, nil
}

func (s *fakeStore) Update(
	_ context.Context, id string, mutate func(api.Course) api.Course,
) (api.Course, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, ok := s.courses[id]
	if !ok {
		return api.Course{}, store.ErrNotFound
	}
	updated := mutate(current)
	updated.ID = current.ID
	s.courses[id] = updated
	return updated, nil
}

func (s *fakeStore) ListRunning(context.Context) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ids := []string{}
	for id, course := range s.courses {
		if course.IngestStatus == api.IngestRunning {
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

func (s *fakeStore) put(course api.Course) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.courses[course.ID] = course
}

func (s *fakeStore) snapshot(id string) api.Course {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.courses[id]
}

func (s *fakeStore) createdCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.created)
}

// fakeRuntime stands in for Temporal. `result` and `runErr` decide how a run ends;
// `lines` is what the progress query reports.
type fakeRuntime struct {
	mu         sync.Mutex
	started    []courses.IngestionInput
	lines      []string
	result     api.IngestResult
	runErr     error
	softened   string
	softenErr  error
	softenSeen string
}

func (f *fakeRuntime) StartIngestion(_ context.Context, input courses.IngestionInput) error {
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

func (f *fakeRuntime) SoftenClaim(_ context.Context, claim string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.softenSeen = claim
	return f.softened, f.softenErr
}

func (f *fakeRuntime) startedRuns() []courses.IngestionInput {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]courses.IngestionInput(nil), f.started...)
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
		Ingestor: courses.NewIngestor(courses.IngestorOptions{
			Repository: h.store,
			Runtime:    h.runtime,
			Logger:     discardLogger(),
			NewID:      func() string { return "course-test" },
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
		Ingestor: courses.NewIngestor(courses.IngestorOptions{
			Repository: fake, Runtime: runtime, Logger: discardLogger(),
		}),
		Knowledge: &fakeKnowledge{},
		Limiter:   limiter,
		Logger:    discardLogger(),
		Timeout:   time.Second,
	})
}

// do issues an authenticated request as Dana, the seeded Specialist.
func do(handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
	return doAs(handler, method, target, body, "user-dana")
}

func doAs(
	handler http.Handler, method, target, body, specialistID string,
) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, target, reader)
	request.Header.Set("X-API-Key", "secret")
	if specialistID != "" {
		request.Header.Set(specialistHeader, specialistID)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func readyCourse(id, specialistID string) api.Course {
	course := api.Course{
		ID: id, SpecialistID: specialistID, SpecialistName: "Dana Mercado",
		Slug: "hold-your-number", Title: "Hold Your Number",
		Tagline: "Stop discounting to close.", PriceCents: 34900,
		Status: api.StatusDraft, IngestStatus: api.IngestReady,
		Positions: []api.Position{{
			Claim: "A price objection is never about price.", Because: "Because reasons.",
			Pushback: "objection → answer", Quote: "verbatim span",
		}},
		Lessons: []api.Lesson{{
			Ord: 1, Title: "Lesson one", Objective: "Can do the thing",
			KeyPoints: []string{"a point"}, BodyMD: "the body",
		}},
		SourceText: "the whole corpus",
		CreatedAt:  "2026-08-26T10:00:00Z", UpdatedAt: "2026-08-26T10:00:00Z",
	}
	course.Normalize()
	return course
}

// withCourse seeds one course owned by Dana.
func withCourse(mutate ...func(*api.Course)) func(*harness) {
	return func(h *harness) {
		course := readyCourse("course-1", "user-dana")
		for _, apply := range mutate {
			apply(&course)
		}
		h.store.put(course)
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

	h.handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/courses", nil))

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}

// The API key proves the caller is the web app; the specialist header says who is
// signed in. A valid key naming an identity nobody seeded is not a Specialist.
func TestAnUnknownSpecialistIsRejected(t *testing.T) {
	h := newHarness(t)

	for _, id := range []string{"", "user-nobody", "../admin"} {
		recorder := doAs(h.handler, http.MethodGet, "/v1/courses", "", id)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("specialist %q: status = %d, want 401", id, recorder.Code)
		}
		if code := decodeError(t, recorder).Code; code != "unknown_user" {
			t.Fatalf("specialist %q: code = %q", id, code)
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
	request := httptest.NewRequest(http.MethodGet, "/v1/courses", nil)
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
	request := httptest.NewRequest(http.MethodGet, "/v1/courses", nil)
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

	recorder := do(handler, http.MethodGet, "/v1/courses", "")

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
			request := httptest.NewRequest(http.MethodGet, "/v1/courses", nil)
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

func TestAnotherSpecialistsCourseIsRefused(t *testing.T) {
	h := newHarness(t, withCourse())

	cases := []struct{ method, target string }{
		{http.MethodGet, "/v1/courses/course-1"},
		{http.MethodPost, "/v1/courses/course-1/publish"},
		{http.MethodPost, "/v1/courses/course-1/reingest"},
		{http.MethodPost, "/v1/courses/course-1/positions/0/soften"},
	}
	for _, testCase := range cases {
		recorder := doAs(h.handler, testCase.method, testCase.target, "", "user-sam")
		if recorder.Code != http.StatusForbidden {
			t.Errorf("%s %s: status = %d, want 403", testCase.method, testCase.target, recorder.Code)
		}
	}
	if h.store.snapshot("course-1").Status == api.StatusPublished {
		t.Fatal("another Specialist published somebody else's course")
	}
}

func TestUnknownCourseIsNotFound(t *testing.T) {
	h := newHarness(t)

	recorder := do(h.handler, http.MethodGet, "/v1/courses/course-missing", "")

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
	}
}

func TestCourseIDsWithPathSeparatorsAreRejected(t *testing.T) {
	h := newHarness(t)

	recorder := do(h.handler, http.MethodGet, "/v1/courses/..%2Fadmin", "")

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}

// ── the withholding rule ─────────────────────────────────────────────────────

// DESIGN.md §4.5 asserted at the edge. The public projection is unauthenticated by
// design — Journey 2's course page has no session — and it must carry the claim and
// nothing else.
func TestPublicAudienceNeedsNoIdentityAndWithholdsTheArgument(t *testing.T) {
	h := newHarness(t, withCourse())

	recorder := doAs(h.handler, http.MethodGet, "/v1/courses/course-1?audience=public", "", "")

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	for _, forbidden := range []string{
		"because", "pushback", "quote", "body_md", "source_text", "voice_card",
		"Because reasons.", "the whole corpus",
	} {
		if strings.Contains(body, forbidden) {
			t.Errorf("public payload leaked %q: %s", forbidden, body)
		}
	}
	if !strings.Contains(body, "A price objection is never about price.") {
		t.Fatalf("public payload dropped the claim, which is the hook: %s", body)
	}
}

// ── patch, publish, soften ───────────────────────────────────────────────────

func TestPatchAppliesOnlyWhatWasSentAndRenumbers(t *testing.T) {
	h := newHarness(t, withCourse())

	recorder := do(h.handler, http.MethodPatch, "/v1/courses/course-1",
		`{"lessons":[{"ord":9,"title":"b"},{"ord":4,"title":"a"}]}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	saved := h.store.snapshot("course-1")
	if saved.Lessons[0].Ord != 1 || saved.Lessons[1].Ord != 2 {
		t.Fatalf("ordinals = %+v", saved.Lessons)
	}
	if saved.Title != "Hold Your Number" {
		t.Fatalf("a lessons-only patch changed the title: %q", saved.Title)
	}
}

func TestPatchRejectsBadEdits(t *testing.T) {
	cases := []struct{ name, body, want string }{
		{name: "nothing to change", body: `{}`, want: "patch"},
		{name: "blank title", body: `{"title":"   "}`, want: "title"},
		{name: "negative price", body: `{"price_cents":-1}`, want: "price_cents"},
		{
			name: "lesson without a title",
			body: `{"lessons":[{"ord":1,"title":""}]}`,
			want: "lessons[0].title",
		},
		{
			name: "position without a claim",
			body: `{"positions":[{"claim":"","because":"b","pushback":"p"}]}`,
			want: "positions[0].claim",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			h := newHarness(t, withCourse())

			recorder := do(h.handler, http.MethodPatch, "/v1/courses/course-1", testCase.body)

			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if !strings.Contains(recorder.Body.String(), testCase.want) {
				t.Fatalf("body = %s, want mention of %q", recorder.Body.String(), testCase.want)
			}
		})
	}
}

func TestPublishReturnsTheShareableLink(t *testing.T) {
	h := newHarness(t, withCourse())

	recorder := do(h.handler, http.MethodPost, "/v1/courses/course-1/publish", "")

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		URL    string     `json:"url"`
		Course api.Course `json:"course"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.URL != "/c/hold-your-number" {
		t.Fatalf("url = %q", response.URL)
	}
	if response.Course.Status != api.StatusPublished {
		t.Fatalf("status = %q", response.Course.Status)
	}
}

func TestPublishReportsEveryBlockerAtOnce(t *testing.T) {
	h := newHarness(t, withCourse(func(c *api.Course) {
		c.Tagline = ""
		c.PriceCents = 0
	}))

	recorder := do(h.handler, http.MethodPost, "/v1/courses/course-1/publish", "")

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
		t.Fatalf("blockers = %v, want both the tagline and the price", envelope.Blockers)
	}
	if h.store.snapshot("course-1").Status == api.StatusPublished {
		t.Fatal("a blocked course was published anyway")
	}
}

// POC_UserJourney.md: fewer than three positions warns, it never blocks.
func TestThinPositionsDoNotBlockPublishing(t *testing.T) {
	h := newHarness(t, withCourse(func(c *api.Course) { c.Positions = []api.Position{} }))

	recorder := do(h.handler, http.MethodPost, "/v1/courses/course-1/publish", "")

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestSoftenRewritesTheClaimInPlace(t *testing.T) {
	h := newHarness(t, withCourse(), func(h *harness) {
		h.runtime.softened = "A price objection is usually not about price."
	})

	recorder := do(h.handler, http.MethodPost, "/v1/courses/course-1/positions/0/soften", "")

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	saved := h.store.snapshot("course-1")
	if saved.Positions[0].Claim != "A price objection is usually not about price." {
		t.Fatalf("claim = %q", saved.Positions[0].Claim)
	}
	// Softening rewrites the hook. The argument behind it is the Specialist's own words
	// and must survive untouched.
	if saved.Positions[0].Because != "Because reasons." {
		t.Fatalf("soften rewrote the argument too: %q", saved.Positions[0].Because)
	}
}

func TestSofteningAPositionThatIsNotThereIsNotFound(t *testing.T) {
	h := newHarness(t, withCourse())

	for _, index := range []string{"7", "-1", "banana"} {
		recorder := do(
			h.handler, http.MethodPost, "/v1/courses/course-1/positions/"+index+"/soften", "",
		)
		if recorder.Code != http.StatusNotFound {
			t.Errorf("index %q: status = %d, want 404", index, recorder.Code)
		}
	}
}

func TestSoftenFailureLeavesTheClaimAlone(t *testing.T) {
	h := newHarness(t, withCourse(), func(h *harness) {
		h.runtime.softenErr = errors.New("no model configured")
	})

	recorder := do(h.handler, http.MethodPost, "/v1/courses/course-1/positions/0/soften", "")

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "no model configured") {
		t.Fatalf("upstream detail leaked: %s", recorder.Body.String())
	}
	if h.store.snapshot("course-1").Positions[0].Claim == "" {
		t.Fatal("a failed rewrite cleared the claim")
	}
}

// ── ingestion ────────────────────────────────────────────────────────────────

func TestIngestValidationRunsBeforeADraftIsWritten(t *testing.T) {
	cases := []struct{ name, body, want string }{
		{
			name: "no title",
			body: `{"tagline":"t","price_cents":1,"source_text":"` + longSource() + `"}`,
			want: "title",
		},
		{
			name: "free",
			body: `{"title":"T","tagline":"t","price_cents":0,"source_text":"` + longSource() + `"}`,
			want: "price_cents",
		},
		{
			name: "not enough material",
			body: `{"title":"T","tagline":"t","price_cents":1,"source_text":"too short"}`,
			want: "source_text",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			h := newHarness(t)

			recorder := do(h.handler, http.MethodPost, "/v1/courses/ingest", testCase.body)

			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if !strings.Contains(recorder.Body.String(), testCase.want) {
				t.Fatalf("body = %s, want mention of %q", recorder.Body.String(), testCase.want)
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
// sees nothing else still knows which course to retry.
func TestIngestStreamsDraftThenStatusThenResult(t *testing.T) {
	h := newHarness(t, func(h *harness) {
		h.runtime.lines = []string{"READING 1 OF 1 FILES · source.md", "EXTRACTING POSITIONS…"}
		h.runtime.result = api.IngestResult{
			Lessons:   []api.Lesson{{Title: "one"}, {Title: "two"}},
			Positions: []api.Position{{Claim: "a claim"}},
		}
	})

	recorder := do(h.handler, http.MethodPost, "/v1/courses/ingest",
		`{"title":"Hold Your Number","tagline":"t","price_cents":34900,"source_text":"`+
			longSource()+`","source_files":["source.md"]}`)

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
	if events[0].Type != "draft" || events[0].CourseID != "course-test" {
		t.Fatalf("first event = %+v, want the draft id before anything can fail", events[0])
	}
	if events[1].Type != "status" || events[2].Type != "status" {
		t.Fatalf("status lines = %+v", events[1:3])
	}
	last := events[len(events)-1]
	if last.Type != "result" || last.CourseID != "course-test" {
		t.Fatalf("last event = %+v", last)
	}

	// The result is persisted by the watcher, not by the stream. "result" must not go
	// out until that has landed, or the client navigates to an empty review screen.
	saved := h.store.snapshot("course-test")
	if saved.IngestStatus != api.IngestReady || len(saved.Lessons) != 2 {
		t.Fatalf("saved course = %+v", saved)
	}
	if saved.Lessons[0].Ord != 1 || saved.Lessons[1].Ord != 2 {
		t.Fatalf("ordinals were not assigned: %+v", saved.Lessons)
	}
}

// A status line is only ever sent once, however many times the query is polled.
func TestStatusLinesAreNotRepeated(t *testing.T) {
	h := newHarness(t, func(h *harness) {
		h.runtime.lines = []string{"READING…", "WRITING LESSON 1 OF 2…"}
		h.runtime.result = api.IngestResult{Lessons: []api.Lesson{{Title: "one"}}}
	})

	recorder := do(h.handler, http.MethodPost, "/v1/courses/ingest",
		`{"title":"T","tagline":"t","price_cents":1,"source_text":"`+longSource()+`"}`)

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

	recorder := do(h.handler, http.MethodPost, "/v1/courses/ingest",
		`{"title":"Hold Your Number","tagline":"t","price_cents":34900,"source_text":"`+
			longSource()+`"}`)

	events := parseEvents(t, recorder.Body.String())
	last := events[len(events)-1]
	if last.Type != "error" || last.Code != "ingest_failed" || last.CourseID != "course-test" {
		t.Fatalf("last event = %+v", last)
	}
	// Infrastructure detail must not reach the person who dropped the files.
	if strings.Contains(recorder.Body.String(), "worker is down") {
		t.Fatalf("upstream detail leaked: %s", recorder.Body.String())
	}

	saved := h.store.snapshot("course-test")
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
		withCourse(func(c *api.Course) {
			c.IngestStatus = api.IngestFailed
			c.IngestError = "The model did not answer in time."
		}),
		func(h *harness) {
			h.runtime.result = api.IngestResult{Lessons: []api.Lesson{{Title: "recovered"}}}
		},
	)

	recorder := do(h.handler, http.MethodPost, "/v1/courses/course-1/reingest", "")

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	started := h.runtime.startedRuns()
	if len(started) != 1 {
		t.Fatalf("started %d runs, want 1", len(started))
	}
	// The whole reason the draft is written before the model runs: a retry never asks
	// the Specialist to find their files again.
	if started[0].SourceText != "the whole corpus" {
		t.Fatalf("retry sent %q as the corpus", started[0].SourceText)
	}
	saved := h.store.snapshot("course-1")
	if saved.IngestStatus != api.IngestReady || saved.IngestError != "" {
		t.Fatalf("saved course = %+v", saved)
	}
}

func TestReingestWithoutSourceMaterialIsAConflict(t *testing.T) {
	h := newHarness(t, withCourse(func(c *api.Course) { c.SourceText = "" }))

	recorder := do(h.handler, http.MethodPost, "/v1/courses/course-1/reingest", "")

	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusConflict)
	}
	if len(h.runtime.startedRuns()) != 0 {
		t.Fatal("a run was started with nothing to ingest")
	}
}

// The watcher runs on its own context so a closed tab cannot lose a finished course.
// Reconcile is what covers the same case across a restart.
func TestReconcileReattachesToInFlightRuns(t *testing.T) {
	fake := newFakeStore()
	running := readyCourse("course-1", "user-dana")
	running.IngestStatus = api.IngestRunning
	running.Lessons = nil
	fake.put(running)

	runtime := &fakeRuntime{result: api.IngestResult{Lessons: []api.Lesson{{Title: "one"}}}}
	ingestor := courses.NewIngestor(courses.IngestorOptions{
		Repository: fake, Runtime: runtime, Logger: discardLogger(), MaxStream: 5 * time.Second,
	})

	if err := ingestor.Reconcile(context.Background()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if fake.snapshot("course-1").IngestStatus == api.IngestReady {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("course was left in %q after reconcile", fake.snapshot("course-1").IngestStatus)
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

// ── knowledge (retained from the reference application) ──────────────────────

func TestKnowledgeUpsertReportsCount(t *testing.T) {
	h := newHarness(t)

	recorder := do(h.handler, http.MethodPost, "/v1/knowledge",
		`{"documents":[{"id":"a","title":"A","content":"body","source":"a"}]}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response api.KnowledgeUpsertResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Upserted != 1 {
		t.Fatalf("upserted = %d, want 1", response.Upserted)
	}
}

func TestMalformedJSONIsRejectedBeforeAnyDependency(t *testing.T) {
	h := newHarness(t)

	recorder := do(h.handler, http.MethodPost, "/v1/knowledge", `{"documents":`)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	if h.knowledge.documents != nil {
		t.Fatal("invalid request reached the vector store")
	}
}

func TestKnowledgeValidationRejectsBadDocuments(t *testing.T) {
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

			recorder := do(h.handler, http.MethodPost, "/v1/knowledge", testCase.body)

			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if !strings.Contains(recorder.Body.String(), testCase.want) {
				t.Fatalf("body = %s, want mention of %q", recorder.Body.String(), testCase.want)
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

	recorder := do(h.handler, http.MethodGet, "/v1/courses", "")

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

	recorder := do(h.handler, http.MethodGet, "/v1/courses", "")

	if recorder.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusGatewayTimeout)
	}
}
