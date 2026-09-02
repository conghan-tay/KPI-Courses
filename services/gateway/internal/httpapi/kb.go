package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/example/reverse-interview/services/gateway/internal/api"
	"github.com/example/reverse-interview/services/gateway/internal/kb"
	"github.com/example/reverse-interview/services/gateway/internal/store"
)

// GET /v1/knowledge-bases — the studio list, scoped to the signed-in candidate.
func (h *Handler) listKnowledgeBases(w http.ResponseWriter, r *http.Request) {
	user, ok := h.candidate(w, r)
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
	summaries := make([]api.KBSummary, len(stored))
	for index, knowledgeBase := range stored {
		summaries[index] = kb.ToSummary(knowledgeBase)
	}
	h.logCompleted(r, http.StatusOK, "")
	writeJSON(w, http.StatusOK, map[string]any{"knowledge_bases": summaries})
}

// GET /v1/knowledge-bases/{id}
//
// `?audience=public` returns the projection a stranger gets and needs no identity —
// Journey 2's /k/:slug page is unauthenticated by definition. Everything else is the
// owner's own copy and is checked as such.
func (h *Handler) getKnowledgeBase(w http.ResponseWriter, r *http.Request) {
	kbID := r.PathValue("kbID")
	if !validPathID(kbID) {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid knowledge base id.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	knowledgeBase, err := h.repository.Get(ctx, kbID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}

	if r.URL.Query().Get("audience") == "public" {
		h.logCompleted(r, http.StatusOK, kbID)
		writeJSON(w, http.StatusOK, map[string]any{
			"knowledge_base": kb.ToPublic(knowledgeBase),
		})
		return
	}

	user, ok := h.candidate(w, r)
	if !ok {
		return
	}
	if knowledgeBase.CandidateID != user.ID {
		h.forbidden(w)
		return
	}
	h.logCompleted(r, http.StatusOK, kbID)
	writeJSON(w, http.StatusOK, map[string]any{"knowledge_base": knowledgeBase})
}

// PATCH /v1/knowledge-bases/{id} — partial edits from the review screen.
func (h *Handler) patchKnowledgeBase(w http.ResponseWriter, r *http.Request) {
	knowledgeBase, ok := h.ownedKnowledgeBase(w, r)
	if !ok {
		return
	}
	var patch api.KBPatch
	if !h.decode(w, r, &patch, maxRequestBytes) {
		return
	}
	if err := patch.Validate(); err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	updated, err := h.repository.Update(
		ctx, knowledgeBase.ID,
		func(current api.KnowledgeBase) api.KnowledgeBase {
			return kb.ApplyPatch(current, patch)
		},
	)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	h.logCompleted(r, http.StatusOK, knowledgeBase.ID)
	writeJSON(w, http.StatusOK, map[string]any{"knowledge_base": updated})
}

// POST /v1/knowledge-bases/{id}/publish
//
// A thin knowledge base warns but never blocks: POC_UserJourney.md is explicit that a
// candidate with a sparse corpus still has something worth publishing. What does block
// is a recruiter-facing screen that cannot work — see PublishBlockers.
func (h *Handler) publishKnowledgeBase(w http.ResponseWriter, r *http.Request) {
	knowledgeBase, ok := h.ownedKnowledgeBase(w, r)
	if !ok {
		return
	}
	if blockers := kb.PublishBlockers(knowledgeBase); len(blockers) > 0 {
		writeErrorWith(
			w, http.StatusConflict, "not_publishable", blockers[0], nil, blockers,
		)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	published, err := h.repository.Update(
		ctx, knowledgeBase.ID,
		func(current api.KnowledgeBase) api.KnowledgeBase {
			current.Status = api.StatusPublished
			return current
		},
	)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	h.logCompleted(r, http.StatusOK, knowledgeBase.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"knowledge_base": published,
		"url":            kb.PublicURL(published),
	})
}

// POST /v1/knowledge-bases/{id}/chips/{index}/rephrase
//
// The rewrite runs as a workflow rather than here, so no model client lives in this
// service. In fake-model mode it returns a deterministic rewrite, which is what keeps
// the button from ever being dead.
func (h *Handler) rephraseChip(w http.ResponseWriter, r *http.Request) {
	knowledgeBase, ok := h.ownedKnowledgeBase(w, r)
	if !ok {
		return
	}
	index, err := strconv.Atoi(r.PathValue("index"))
	if err != nil || index < 0 || index >= len(knowledgeBase.Chips) {
		writeError(w, http.StatusNotFound, "not_found", "No such question.")
		return
	}

	// The register to rewrite into comes from the query string, so the review screen can
	// offer "make this blunter" rather than only "say it differently". An unrecognised
	// value falls through to the chip's current register rather than 400-ing a button.
	register := r.URL.Query().Get("register")
	if register == "" {
		register = knowledgeBase.Chips[index].Register
	}

	// A model call, not a database call, so it gets its own budget rather than the
	// gateway's ordinary dependency timeout.
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()

	text, err := h.runtime.RephraseChip(ctx, knowledgeBase.Chips[index].Text, register)
	if err != nil {
		h.logFailure(r, err)
		writeError(
			w, http.StatusBadGateway, "model_error",
			"The rewrite failed. Edit the question yourself, or try again.",
		)
		return
	}

	updated, err := h.repository.Update(
		ctx, knowledgeBase.ID,
		func(current api.KnowledgeBase) api.KnowledgeBase {
			// Re-checked inside the transaction: the candidate may have deleted a chip
			// while the model was thinking, and writing to an index that has moved would
			// rewrite the wrong question.
			if index < len(current.Chips) {
				current.Chips[index].Text = text
				current.Chips[index].Register = register
			}
			return current
		},
	)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	h.logCompleted(r, http.StatusOK, knowledgeBase.ID)
	writeJSON(w, http.StatusOK, map[string]any{"knowledge_base": updated})
}

// POST /v1/knowledge-bases/ingest — files-turned-text plus meta, in; a draft knowledge
// base and a stream of status, out.
func (h *Handler) ingestKnowledgeBase(w http.ResponseWriter, r *http.Request) {
	user, ok := h.candidate(w, r)
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

	knowledgeBase, err := h.ingestor.Begin(startCtx, user, request)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	h.logCompleted(r, http.StatusOK, knowledgeBase.ID)
	h.streamIngestion(w, r, knowledgeBase.ID)
}

// POST /v1/knowledge-bases/{id}/reingest — the retry behind a failed draft.
//
// The source text was stored on the way in, so this never asks the candidate to
// re-upload anything. That is the whole point of writing the draft before the pipeline
// runs.
func (h *Handler) reingestKnowledgeBase(w http.ResponseWriter, r *http.Request) {
	knowledgeBase, ok := h.ownedKnowledgeBase(w, r)
	if !ok {
		return
	}
	if knowledgeBase.SourceText == "" {
		writeError(
			w, http.StatusConflict, "no_source",
			"This draft has no source material left to build from.",
		)
		return
	}
	startCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), h.timeout)
	defer cancel()

	if err := h.ingestor.Retry(startCtx, knowledgeBase); err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	h.logCompleted(r, http.StatusOK, knowledgeBase.ID)
	h.streamIngestion(w, r, knowledgeBase.ID)
}

// streamIngestion writes the server-sent events the ingestion panel renders.
//
// The client reads this with fetch + getReader rather than EventSource, because
// EventSource cannot POST — see ingestKnowledgeBase in services/web/lib/api-client.ts.
func (h *Handler) streamIngestion(w http.ResponseWriter, r *http.Request, kbID string) {
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
	h.ingestor.Stream(r.Context(), kbID, func(event api.IngestEvent) {
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

// ownedKnowledgeBase resolves the caller, loads the knowledge base from the path, and
// refuses one that is not theirs. Every mutating route starts here, so the ownership
// check cannot be forgotten on a new one.
func (h *Handler) ownedKnowledgeBase(
	w http.ResponseWriter, r *http.Request,
) (api.KnowledgeBase, bool) {
	kbID := r.PathValue("kbID")
	if !validPathID(kbID) {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid knowledge base id.")
		return api.KnowledgeBase{}, false
	}
	user, ok := h.candidate(w, r)
	if !ok {
		return api.KnowledgeBase{}, false
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	knowledgeBase, err := h.repository.Get(ctx, kbID)
	if err != nil {
		// One that exists but belongs to somebody else is reported the same way as one
		// that does not, so this endpoint is not a directory of other people's drafts.
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "No such knowledge base.")
			return api.KnowledgeBase{}, false
		}
		h.writeServiceError(w, r, err)
		return api.KnowledgeBase{}, false
	}
	if knowledgeBase.CandidateID != user.ID {
		h.forbidden(w)
		return api.KnowledgeBase{}, false
	}
	return knowledgeBase, true
}

func (h *Handler) forbidden(w http.ResponseWriter) {
	writeError(w, http.StatusForbidden, "forbidden", "That isn't yours.")
}
