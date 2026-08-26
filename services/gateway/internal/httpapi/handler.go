package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/example/kpi-courses/services/gateway/internal/api"
	"github.com/example/kpi-courses/services/gateway/internal/courses"
	"github.com/example/kpi-courses/services/gateway/internal/knowledge"
	"github.com/example/kpi-courses/services/gateway/internal/store"
)

// maxRequestBytes bounds an ordinary JSON body. Ingestion is the exception: a corpus is
// legitimately large, so that route gets its own, wider limit.
const (
	maxRequestBytes = 1 << 20
	maxIngestBytes  = 8 << 20
)

// specialistHeader carries the identity of the caller.
//
// The gateway trusts it because the API key gates this hop and the only caller is the
// web app's route handlers, which resolve it from a signed-in cookie. That is exactly
// as strong as POC_UserJourney.md §0's "dev-mode role switcher, real auth is a Monday
// problem" — which is to say, not strong at all. Anything holding this API key can act
// as any seeded user. Replacing this with a real token is the first thing to do before
// this service meets a real user.
const specialistHeader = "X-Specialist-Id"

// HealthChecker reports whether the agent runtime is reachable. Implemented by the
// Temporal client; kept as an interface so tests need no Temporal server.
type HealthChecker interface {
	CheckHealth(ctx context.Context) error
}

// Handler is the public API. It owns authentication, rate limiting, validation, and
// HTTP semantics; persistence and the agent runtime are reached only through the store,
// ingestor and runtime interfaces.
type Handler struct {
	apiKey     string
	repository store.Repository
	ingestor   *courses.Ingestor
	runtime    courses.Runtime
	knowledge  knowledge.Repository
	health     HealthChecker
	limiter    RateLimiter
	logger     *slog.Logger
	timeout    time.Duration
}

// Options bundles the handler's collaborators; there are enough of them now that
// positional parameters would be easy to transpose.
type Options struct {
	APIKey     string
	Repository store.Repository
	Ingestor   *courses.Ingestor
	Runtime    courses.Runtime
	Knowledge  knowledge.Repository
	Health     HealthChecker
	Limiter    RateLimiter
	Logger     *slog.Logger
	Timeout    time.Duration
}

func New(options Options) http.Handler {
	if options.Limiter == nil {
		options.Limiter = allowAllLimiter{}
	}
	h := &Handler{
		apiKey:     options.APIKey,
		repository: options.Repository,
		ingestor:   options.Ingestor,
		runtime:    options.Runtime,
		knowledge:  options.Knowledge,
		health:     options.Health,
		limiter:    options.Limiter,
		logger:     options.Logger,
		timeout:    options.Timeout,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", h.healthz)
	mux.HandleFunc("GET /readyz", h.readyz)

	mux.HandleFunc("GET /v1/courses", h.listCourses)
	mux.HandleFunc("POST /v1/courses/ingest", h.ingestCourse)
	mux.HandleFunc("GET /v1/courses/{courseID}", h.getCourse)
	mux.HandleFunc("PATCH /v1/courses/{courseID}", h.patchCourse)
	mux.HandleFunc("POST /v1/courses/{courseID}/publish", h.publishCourse)
	mux.HandleFunc("POST /v1/courses/{courseID}/reingest", h.reingestCourse)
	mux.HandleFunc("POST /v1/courses/{courseID}/positions/{index}/soften", h.softenPosition)

	// Retained from the reference application. Nothing reads these vectors yet;
	// Journey 3's tutor is the caller they exist for.
	mux.HandleFunc("POST /v1/knowledge", h.upsertKnowledge)
	return h.requestContext(h.authenticate(mux))
}

// healthz is liveness only: it must not depend on Temporal, or a Temporal blip would
// have orchestrators restarting healthy gateways.
func (h *Handler) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "gateway"})
}

// readyz reports whether this gateway can currently reach the agent runtime.
func (h *Handler) readyz(w http.ResponseWriter, r *http.Request) {
	if h.health == nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := h.health.CheckHealth(ctx); err != nil {
		h.logger.Warn("readiness check failed", "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"status": "unavailable", "detail": "agent runtime unreachable",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// upsertKnowledge writes straight to the vector store. It stays synchronous because
// seeding is a short, idempotent operation whose result the caller wants.
func (h *Handler) upsertKnowledge(w http.ResponseWriter, r *http.Request) {
	var request api.KnowledgeUpsertRequest
	if !h.decode(w, r, &request, maxRequestBytes) {
		return
	}
	if err := request.Validate(); err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	upserted, err := h.knowledge.Upsert(ctx, request.Documents)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	h.logCompleted(r, http.StatusOK, "")
	writeJSON(w, http.StatusOK, api.KnowledgeUpsertResponse{Upserted: upserted})
}

// specialist resolves the caller, writing the error response itself. It returns false
// when the caller should stop.
func (h *Handler) specialist(w http.ResponseWriter, r *http.Request) (api.User, bool) {
	id := r.Header.Get(specialistHeader)
	if !validPathID(id) {
		writeError(w, http.StatusUnauthorized, "unknown_user", "Sign in first.")
		return api.User{}, false
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	user, err := h.repository.User(ctx, id)
	if err != nil {
		if errors.Is(err, store.ErrUnknownUser) {
			writeError(w, http.StatusUnauthorized, "unknown_user", "Sign in first.")
			return api.User{}, false
		}
		h.writeServiceError(w, r, err)
		return api.User{}, false
	}
	return user, true
}

// decode reads and unmarshals a JSON body, writing the error response itself. It
// returns false when the caller should stop.
func (h *Handler) decode(
	w http.ResponseWriter, r *http.Request, target any, limit int64,
) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		writeError(
			w, http.StatusUnsupportedMediaType, "unsupported_media_type",
			"Content-Type must be application/json",
		)
		return false
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		writeError(
			w, http.StatusRequestEntityTooLarge, "too_large",
			"That's more than we can take at once.",
		)
		return false
	}
	if err := json.Unmarshal(body, target); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Request body must be valid JSON.")
		return false
	}
	return true
}

// writeServiceError is the single place that decides an HTTP status for a failure, so
// the API cannot drift between routes.
func (h *Handler) writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	var validation *api.ValidationError
	switch {
	case errors.As(err, &validation):
		writeErrorWith(
			w, http.StatusBadRequest, "invalid_request", validation.Error(),
			map[string]string{validation.Field: validation.Message}, nil,
		)
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "No such course.")
	case errors.Is(err, store.ErrUnknownUser):
		writeError(w, http.StatusUnauthorized, "unknown_user", "Sign in first.")
	case errors.Is(err, courses.ErrAlreadyRunning):
		writeError(
			w, http.StatusConflict, "already_running",
			"That course is already being built. Wait for it to finish.",
		)
	case errors.Is(err, context.DeadlineExceeded):
		h.logFailure(r, err)
		writeError(
			w, http.StatusGatewayTimeout, "timeout",
			"The agent runtime did not respond in time.",
		)
	default:
		h.logFailure(r, err)
		writeError(w, http.StatusBadGateway, "upstream_unavailable", "Something upstream is down.")
	}
}

func (h *Handler) logFailure(r *http.Request, err error) {
	h.logger.Error(
		"gateway request failed",
		"error", err,
		"request_id", requestIDFrom(r.Context()),
		"method", r.Method,
		"path", r.URL.Path,
	)
}

func (h *Handler) logCompleted(r *http.Request, status int, courseID string) {
	h.logger.Info(
		"gateway request completed",
		"request_id", requestIDFrom(r.Context()),
		"method", r.Method,
		"path", r.URL.Path,
		"status", status,
		"course_id", courseID,
	)
}

func (h *Handler) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
			next.ServeHTTP(w, r)
			return
		}
		allowed, err := h.limiter.Allow(r.Context(), rateLimitKey(r))
		if err != nil {
			// Rate limiting fails open so a Redis outage does not take down the studio.
			h.logger.Warn("rate limiter unavailable", "error", err)
		} else if !allowed {
			writeError(w, http.StatusTooManyRequests, "rate_limited", "Slow down a moment.")
			return
		}
		provided := r.Header.Get("X-API-Key")
		if provided == "" {
			provided = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		}
		if subtle.ConstantTimeCompare([]byte(provided), []byte(h.apiKey)) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Invalid API key.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func rateLimitKey(r *http.Request) string {
	if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); forwarded != "" {
		if addr, err := netip.ParseAddr(forwarded); err == nil {
			return addr.String()
		}
	}
	// net.SplitHostPort rather than a cut at the first colon: RemoteAddr for an IPv6
	// client is "[2001:db8::1]:54321", and cutting there yields "[", collapsing every
	// IPv6 caller in the world into a single shared bucket.
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

type contextKey string

const requestIDKey contextKey = "request-id"

func (h *Handler) requestContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" || len(requestID) > 100 {
			requestID = fmt.Sprintf("req-%d", time.Now().UnixNano())
		}
		w.Header().Set("X-Request-ID", requestID)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey, requestID)))
	})
}

func requestIDFrom(ctx context.Context) string {
	value, _ := ctx.Value(requestIDKey).(string)
	return value
}

func validPathID(value string) bool {
	return value != "" && len(value) <= 100 && !strings.ContainsAny(value, "/\\")
}

// errorEnvelope is the one error shape this API produces. The web client branches on
// `error.code` — `not_publishable` lists blockers, `invalid_request` puts a message
// next to a field — so a bare string here would break every designed failure state.
// See ApiError in services/web/lib/api-client.ts.
type errorEnvelope struct {
	Code     string            `json:"code"`
	Message  string            `json:"message"`
	Fields   map[string]string `json:"fields,omitempty"`
	Blockers []string          `json:"blockers,omitempty"`
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeErrorWith(w, status, code, message, nil, nil)
}

func writeErrorWith(
	w http.ResponseWriter, status int, code, message string,
	fields map[string]string, blockers []string,
) {
	writeJSON(w, status, map[string]errorEnvelope{
		"error": {Code: code, Message: message, Fields: fields, Blockers: blockers},
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		// Every payload here is a plain struct or map, so this is unreachable short of
		// a programming error.
		http.Error(w, `{"error":{"code":"internal","message":"internal error"}}`,
			http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}
