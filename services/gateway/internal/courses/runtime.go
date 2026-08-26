package courses

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"

	"github.com/example/kpi-courses/services/gateway/internal/api"
)

// These names are the cross-language contract with the Python worker. They must match
// the @workflow.defn / @workflow.query names declared in
// services/agent/app/temporal/course_workflow.py. Renaming any of them is a breaking
// change that shows up as a workflow task failure, not a compile error.
const (
	workflowCourseIngestion = "CourseIngestionWorkflow"
	workflowSoftenClaim     = "SoftenClaimWorkflow"
	queryIngestProgress     = "get_progress"
)

// A workflow id derived from the course id, so progress for a course is addressable
// without storing a run id anywhere. A retry reuses it: there is only ever one
// ingestion in flight per course.
func ingestionWorkflowID(courseID string) string { return "ingest-" + courseID }

var (
	// ErrAlreadyRunning means an ingestion for this course is still in flight, so a
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
	CourseID       string   `json:"course_id"`
	SpecialistName string   `json:"specialist_name"`
	Title          string   `json:"title"`
	Tagline        string   `json:"tagline"`
	SourceText     string   `json:"source_text"`
	SourceFiles    []string `json:"source_files"`
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
	Progress(ctx context.Context, courseID string) (api.IngestProgress, error)
	// AwaitResult blocks until the run finishes. Called from a background watcher, not
	// from a request.
	AwaitResult(ctx context.Context, courseID string) (api.IngestResult, error)
	// SoftenClaim rewrites one claim. Synchronous: it is a single small call and the
	// caller wants the answer.
	SoftenClaim(ctx context.Context, claim string) (string, error)
}

// TemporalRuntime drives the course workflows.
type TemporalRuntime struct {
	client           client.Client
	taskQueue        string
	executionTimeout time.Duration
	softenTimeout    time.Duration
}

func NewTemporalRuntime(
	temporalClient client.Client, taskQueue string, executionTimeout time.Duration,
) *TemporalRuntime {
	return &TemporalRuntime{
		client:           temporalClient,
		taskQueue:        taskQueue,
		executionTimeout: executionTimeout,
		softenTimeout:    60 * time.Second,
	}
}

func (r *TemporalRuntime) StartIngestion(ctx context.Context, input IngestionInput) error {
	options := client.StartWorkflowOptions{
		ID:        ingestionWorkflowID(input.CourseID),
		TaskQueue: r.taskQueue,
		// ALLOW_DUPLICATE lets a retry reuse the id once the previous run has closed,
		// which is exactly what [RETRY INGESTION] is. A run that is still open is
		// rejected below rather than silently joined.
		WorkflowIDReusePolicy: enums.WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE,
		// A bound on the whole run, so a worker that wedges eventually surfaces as a
		// failed draft the Specialist can retry instead of a spinner forever.
		WorkflowExecutionTimeout: r.executionTimeout,
	}
	_, err := r.client.ExecuteWorkflow(ctx, options, workflowCourseIngestion, input)
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
	ctx context.Context, courseID string,
) (api.IngestProgress, error) {
	encoded, err := r.client.QueryWorkflow(
		ctx, ingestionWorkflowID(courseID), "", queryIngestProgress,
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
	ctx context.Context, courseID string,
) (api.IngestResult, error) {
	run := r.client.GetWorkflow(ctx, ingestionWorkflowID(courseID), "")
	var result api.IngestResult
	if err := run.Get(ctx, &result); err != nil {
		return api.IngestResult{}, translateRunError(err)
	}
	return result, nil
}

func (r *TemporalRuntime) SoftenClaim(ctx context.Context, claim string) (string, error) {
	options := client.StartWorkflowOptions{
		// One-shot and uniquely identified: two Specialists softening at once must not
		// attach to each other's run.
		ID:                       "soften-" + uuid.NewString(),
		TaskQueue:                r.taskQueue,
		WorkflowIDReusePolicy:    enums.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
		WorkflowExecutionTimeout: r.softenTimeout,
	}
	run, err := r.client.ExecuteWorkflow(
		ctx, options, workflowSoftenClaim, api.SoftenRequest{Claim: claim},
	)
	if err != nil {
		return "", fmt.Errorf("start soften workflow: %w", err)
	}
	var result api.SoftenResult
	if err := run.Get(ctx, &result); err != nil {
		return "", fmt.Errorf("soften claim: %w", err)
	}
	return result.Claim, nil
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
