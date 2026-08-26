package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/example/kpi-courses/services/gateway/internal/api"
	"github.com/example/kpi-courses/services/gateway/internal/courses"
	"github.com/example/kpi-courses/services/gateway/internal/store"
)

// GET /v1/courses — the studio list, scoped to the signed-in Specialist.
func (h *Handler) listCourses(w http.ResponseWriter, r *http.Request) {
	user, ok := h.specialist(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	stored, err := h.repository.List(ctx, user.ID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	summaries := make([]api.CourseSummary, len(stored))
	for index, course := range stored {
		summaries[index] = courses.ToSummary(course)
	}
	h.logCompleted(r, http.StatusOK, "")
	writeJSON(w, http.StatusOK, map[string]any{"courses": summaries})
}

// GET /v1/courses/{id}
//
// `?audience=public` returns the projection a stranger gets and needs no identity —
// Journey 2's course page is unauthenticated by definition. Everything else is the
// owner's own copy and is checked as such.
func (h *Handler) getCourse(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("courseID")
	if !validPathID(courseID) {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid course id.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	course, err := h.repository.Get(ctx, courseID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}

	if r.URL.Query().Get("audience") == "public" {
		h.logCompleted(r, http.StatusOK, courseID)
		writeJSON(w, http.StatusOK, map[string]any{"course": courses.ToPublic(course)})
		return
	}

	user, ok := h.specialist(w, r)
	if !ok {
		return
	}
	if course.SpecialistID != user.ID {
		h.forbidden(w)
		return
	}
	h.logCompleted(r, http.StatusOK, courseID)
	writeJSON(w, http.StatusOK, map[string]any{"course": course})
}

// PATCH /v1/courses/{id} — partial edits from the review screen.
func (h *Handler) patchCourse(w http.ResponseWriter, r *http.Request) {
	course, ok := h.ownedCourse(w, r)
	if !ok {
		return
	}
	var patch api.CoursePatch
	if !h.decode(w, r, &patch, maxRequestBytes) {
		return
	}
	if err := patch.Validate(); err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	updated, err := h.repository.Update(ctx, course.ID, func(current api.Course) api.Course {
		return courses.ApplyPatch(current, patch)
	})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	h.logCompleted(r, http.StatusOK, course.ID)
	writeJSON(w, http.StatusOK, map[string]any{"course": updated})
}

// POST /v1/courses/{id}/publish
//
// Thin positions warn but never block: POC_UserJourney.md is explicit that a Specialist
// with two stances and forty pages of craft still has a course worth selling.
func (h *Handler) publishCourse(w http.ResponseWriter, r *http.Request) {
	course, ok := h.ownedCourse(w, r)
	if !ok {
		return
	}
	if blockers := courses.PublishBlockers(course); len(blockers) > 0 {
		writeErrorWith(
			w, http.StatusConflict, "not_publishable", blockers[0], nil, blockers,
		)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	published, err := h.repository.Update(ctx, course.ID, func(current api.Course) api.Course {
		current.Status = api.StatusPublished
		return current
	})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	h.logCompleted(r, http.StatusOK, course.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"course": published,
		"url":    courses.PublicURL(published),
	})
}

// POST /v1/courses/{id}/positions/{index}/soften
//
// The rewrite runs as a workflow rather than here, so no model client lives in this
// service. In fake-model mode it returns a deterministic hedge, which is what keeps the
// button from ever being dead.
func (h *Handler) softenPosition(w http.ResponseWriter, r *http.Request) {
	course, ok := h.ownedCourse(w, r)
	if !ok {
		return
	}
	index, err := strconv.Atoi(r.PathValue("index"))
	if err != nil || index < 0 || index >= len(course.Positions) {
		writeError(w, http.StatusNotFound, "not_found", "No such position.")
		return
	}

	// A model call, not a database call, so it gets its own budget rather than the
	// gateway's ordinary dependency timeout.
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()

	claim, err := h.runtime.SoftenClaim(ctx, course.Positions[index].Claim)
	if err != nil {
		h.logFailure(r, err)
		writeError(
			w, http.StatusBadGateway, "model_error",
			"The rewrite failed. Edit the claim yourself, or try again.",
		)
		return
	}

	updated, err := h.repository.Update(ctx, course.ID, func(current api.Course) api.Course {
		// Re-checked inside the transaction: the Specialist may have deleted a position
		// while the model was thinking, and writing to an index that has moved would
		// soften the wrong stance.
		if index < len(current.Positions) {
			current.Positions[index].Claim = claim
		}
		return current
	})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	h.logCompleted(r, http.StatusOK, course.ID)
	writeJSON(w, http.StatusOK, map[string]any{"course": updated})
}

// POST /v1/courses/ingest — files-turned-text plus meta, in; a draft course and a
// stream of status, out.
func (h *Handler) ingestCourse(w http.ResponseWriter, r *http.Request) {
	user, ok := h.specialist(w, r)
	if !ok {
		return
	}
	var request api.IngestRequest
	if !h.decode(w, r, &request, maxIngestBytes) {
		return
	}
	if err := request.Validate(); err != nil {
		h.writeServiceError(w, r, err)
		return
	}

	// Starting the run must not be cut short by this request's own deadline: the draft
	// is written here and the workflow outlives the response.
	startCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), h.timeout)
	defer cancel()

	course, err := h.ingestor.Begin(startCtx, user, request)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	h.logCompleted(r, http.StatusOK, course.ID)
	h.streamIngestion(w, r, course.ID)
}

// POST /v1/courses/{id}/reingest — the retry behind a failed draft.
//
// The source text was stored on the way in, so this never asks the Specialist to
// re-upload anything. That is the whole point of writing the draft before the model
// runs.
func (h *Handler) reingestCourse(w http.ResponseWriter, r *http.Request) {
	course, ok := h.ownedCourse(w, r)
	if !ok {
		return
	}
	if course.SourceText == "" {
		writeError(
			w, http.StatusConflict, "no_source",
			"This draft has no source material left to build from.",
		)
		return
	}
	startCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), h.timeout)
	defer cancel()

	if err := h.ingestor.Retry(startCtx, course); err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	h.logCompleted(r, http.StatusOK, course.ID)
	h.streamIngestion(w, r, course.ID)
}

// streamIngestion writes the server-sent events the ingestion panel renders.
//
// The client reads this with fetch + getReader rather than EventSource, because
// EventSource cannot POST — see ingestCourse in services/web/lib/api-client.ts.
func (h *Handler) streamIngestion(w http.ResponseWriter, r *http.Request, courseID string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		// Without flushing, every status line would arrive at once at the end, which is
		// the one thing this endpoint exists not to do.
		h.logger.Error("response writer cannot flush; ingestion cannot stream")
		writeError(w, http.StatusInternalServerError, "internal", "Streaming is unavailable.")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	// Nginx and friends buffer streamed responses into uselessness.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	encoder := json.NewEncoder(w)
	h.ingestor.Stream(r.Context(), courseID, func(event api.IngestEvent) {
		if _, err := w.Write([]byte("data: ")); err != nil {
			return
		}
		// Encode writes the trailing newline; the second one closes the SSE frame.
		if err := encoder.Encode(event); err != nil {
			return
		}
		_, _ = w.Write([]byte("\n"))
		flusher.Flush()
	})
}

// ownedCourse resolves the caller, loads the course from the path, and refuses one that
// is not theirs. Every mutating route starts here, so the ownership check cannot be
// forgotten on a new one.
func (h *Handler) ownedCourse(w http.ResponseWriter, r *http.Request) (api.Course, bool) {
	courseID := r.PathValue("courseID")
	if !validPathID(courseID) {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid course id.")
		return api.Course{}, false
	}
	user, ok := h.specialist(w, r)
	if !ok {
		return api.Course{}, false
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	course, err := h.repository.Get(ctx, courseID)
	if err != nil {
		// A course that exists but belongs to somebody else is reported the same way as
		// one that does not, so this endpoint is not a directory of other people's
		// drafts.
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "No such course.")
			return api.Course{}, false
		}
		h.writeServiceError(w, r, err)
		return api.Course{}, false
	}
	if course.SpecialistID != user.ID {
		h.forbidden(w)
		return api.Course{}, false
	}
	return course, true
}

func (h *Handler) forbidden(w http.ResponseWriter) {
	writeError(w, http.StatusForbidden, "forbidden", "That isn't your course.")
}
