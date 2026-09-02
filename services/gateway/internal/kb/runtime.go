package kb

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"

	"github.com/example/reverse-interview/services/gateway/internal/api"
)

// These names are the cross-language contract with the Python worker. They must match
// the @workflow.defn / @workflow.query names declared in
// services/agent/app/temporal/kb_workflow.py. Renaming any of them is a breaking
// change that shows up as a workflow task failure, not a compile error.
const (
	workflowKBIngestion  = "KnowledgeBaseIngestionWorkflow"
	workflowRephraseChip = "RephraseChipWorkflow"
	queryIngestProgress  = "get_progress"
)

// A workflow id derived from the knowledge-base id, so progress is addressable without
// storing a run id anywhere. A retry reuses it: there is only ever one
// ingestion in flight per knowledge base.
func ingestionWorkflowID(kbID string) string { return "ingest-" + kbID }

var (
	// ErrAlreadyRunning means an ingestion for this knowledge base is still in flight, so a
	// second one would be a duplicate rather than a retry.
	ErrAlreadyRunning = errors.New("ingestion is already running")
	// ErrRunNotFound means Temporal has no record of the run — it was never started,
	// or its retention window has passed.
	ErrRunNotFound = errors.New("ingestion run not found")
)

// IngestionInput is the workflow argument. It carries text rather than files: upload
// handling lives in the web app, which keeps raw PDF bytes away from Temporal's payload
// limit and keeps pdf.js-quality extraction where pdf.js is.
type IngestionInput struct {
	KBID          string   `json:"kb_id"`
	CandidateName string   `json:"candidate_name"`
	Title         string   `json:"title"`
	Tagline       string   `json:"tagline"`
	SourceText    string   `json:"source_text"`
	SourceFiles   []string `json:"source_files"`
}

// Runtime is the gateway's view of the agent runtime. The handler and the ingestor
// depend on this rather than on a Temporal client, so their tests need no Temporal
// server.
type Runtime interface {
	// StartIngestion begins a durable run and returns immediately. The model may take
	// minutes; the run outlives any HTTP request.
	StartIngestion(ctx context.Context, input IngestionInput) error
	// Progress reads the status lines a run has emitted so far. Temporal cannot push,
	// so this is what the SSE stream polls.
	Progress(ctx context.Context, kbID string) (api.IngestProgress, error)
	// AwaitResult blocks until the run finishes. Called from a background watcher, not
	// from a request.
	AwaitResult(ctx context.Context, kbID string) (api.IngestResult, error)
	// RephraseChip rewrites one opening question in a different register. Synchronous:
	// it is a single small call and the caller wants the answer.
	RephraseChip(ctx context.Context, text, register string) (string, error)
}

// TemporalRuntime drives the ingestion and rephrase workflows.
type TemporalRuntime struct {
	client           client.Client
	taskQueue        string
	executionTimeout time.Duration
	rephraseTimeout  time.Duration
}

func NewTemporalRuntime(
	temporalClient client.Client, taskQueue string, executionTimeout time.Duration,
) *TemporalRuntime {
	return &TemporalRuntime{
		client:           temporalClient,
		taskQueue:        taskQueue,
		executionTimeout: executionTimeout,
		rephraseTimeout:  60 * time.Second,
	}
}

func (r *TemporalRuntime) StartIngestion(ctx context.Context, input IngestionInput) error {
	options := client.StartWorkflowOptions{
		ID:        ingestionWorkflowID(input.KBID),
		TaskQueue: r.taskQueue,
		// ALLOW_DUPLICATE lets a retry reuse the id once the previous run has closed,
		// which is exactly what [RETRY INGESTION] is. A run that is still open is
		// rejected below rather than silently joined.
		WorkflowIDReusePolicy: enums.WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE,
		// A bound on the whole run, so a worker that wedges eventually surfaces as a
		// failed draft the candidate can retry instead of a spinner forever.
		WorkflowExecutionTimeout: r.executionTimeout,
	}
	_, err := r.client.ExecuteWorkflow(ctx, options, workflowKBIngestion, input)
	if err != nil {
		var alreadyStarted *serviceerror.WorkflowExecutionAlreadyStarted
		if errors.As(err, &alreadyStarted) {
			return ErrAlreadyRunning
		}
		return fmt.Errorf("start ingestion workflow: %w", err)
	}
	return nil
}

func (r *TemporalRuntime) Progress(
	ctx context.Context, kbID string,
) (api.IngestProgress, error) {
	encoded, err := r.client.QueryWorkflow(
		ctx, ingestionWorkflowID(kbID), "", queryIngestProgress,
	)
	if err != nil {
		return api.IngestProgress{}, translateRunError(err)
	}
	var progress api.IngestProgress
	if err := encoded.Get(&progress); err != nil {
		return api.IngestProgress{}, fmt.Errorf("decode ingest progress: %w", err)
	}
	if progress.Lines == nil {
		progress.Lines = []string{}
	}
	return progress, nil
}

func (r *TemporalRuntime) AwaitResult(
	ctx context.Context, kbID string,
) (api.IngestResult, error) {
	run := r.client.GetWorkflow(ctx, ingestionWorkflowID(kbID), "")
	var result api.IngestResult
	if err := run.Get(ctx, &result); err != nil {
		return api.IngestResult{}, translateRunError(err)
	}
	return result, nil
}

func (r *TemporalRuntime) RephraseChip(
	ctx context.Context, text, register string,
) (string, error) {
	options := client.StartWorkflowOptions{
		// One-shot and uniquely identified: two candidates rephrasing at once must not
		// attach to each other's run.
		ID:                       "rephrase-" + uuid.NewString(),
		TaskQueue:                r.taskQueue,
		WorkflowIDReusePolicy:    enums.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
		WorkflowExecutionTimeout: r.rephraseTimeout,
	}
	run, err := r.client.ExecuteWorkflow(
		ctx, options, workflowRephraseChip,
		api.RephraseRequest{Text: text, Register: register},
	)
	if err != nil {
		return "", fmt.Errorf("start rephrase workflow: %w", err)
	}
	var result api.RephraseResult
	if err := run.Get(ctx, &result); err != nil {
		return "", fmt.Errorf("rephrase chip: %w", err)
	}
	return result.Text, nil
}

// translateRunError maps Temporal's transport errors onto this package's sentinels, so
// the HTTP layer never imports Temporal.
func translateRunError(err error) error {
	var notFound *serviceerror.NotFound
	if errors.As(err, &notFound) {
		return ErrRunNotFound
	}
	return err
}
