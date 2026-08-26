package courses

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"go.temporal.io/sdk/temporal"

	"github.com/example/kpi-courses/services/gateway/internal/api"
	"github.com/example/kpi-courses/services/gateway/internal/store"
)

// pollInterval is how often the SSE stream asks the workflow what it is doing. Fast
// enough that a status line feels live, slow enough that a dozen concurrent ingests are
// not a load test against Temporal.
const pollInterval = 400 * time.Millisecond

// Ingestor owns the lifecycle of an ingestion run: it writes the draft, starts the
// workflow, and — separately from any HTTP request — persists whatever comes back.
//
// The separation is the point. The Specialist is told "don't close the tab", but a
// closed tab must not lose a finished course, so the request streams progress while a
// background watcher does the actual saving.
type Ingestor struct {
	repository store.Repository
	runtime    Runtime
	logger     *slog.Logger
	// now and newID are injected so the whole flow is deterministic under test.
	now   func() time.Time
	newID func() string
	// maxStream bounds how long one SSE response stays open. The run is durable and
	// continues past it; only the streaming stops.
	maxStream time.Duration
}

type IngestorOptions struct {
	Repository store.Repository
	Runtime    Runtime
	Logger     *slog.Logger
	Now        func() time.Time
	NewID      func() string
	MaxStream  time.Duration
}

func NewIngestor(options IngestorOptions) *Ingestor {
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.NewID == nil {
		options.NewID = NewCourseID
	}
	if options.MaxStream == 0 {
		options.MaxStream = 30 * time.Minute
	}
	return &Ingestor{
		repository: options.Repository,
		runtime:    options.Runtime,
		logger:     options.Logger,
		now:        options.Now,
		newID:      options.NewID,
		maxStream:  options.MaxStream,
	}
}

// Begin writes the draft and starts the run.
//
// Order matters and is the whole of "ingestion timeout → keep the draft, offer retry":
// the row exists before anything can fail, so the client always leaves with a course id
// even when the model never answers.
func (i *Ingestor) Begin(
	ctx context.Context, user api.User, request api.IngestRequest,
) (api.Course, error) {
	draft := NewDraft(i.newID(), user, request, api.Timestamp(i.now()))

	created, err := i.repository.Create(ctx, draft)
	if err != nil {
		return api.Course{}, fmt.Errorf("create draft: %w", err)
	}
	if err := i.start(ctx, created); err != nil {
		// The draft survives a failed start, so the studio shows a retryable row rather
		// than swallowing the upload.
		i.fail(ctx, created.ID, "Ingestion could not be started.")
		return created, err
	}
	return created, nil
}

// Retry re-runs ingestion from the stored source text, so it never asks the Specialist
// to re-upload anything. That is the entire reason the draft is written first.
func (i *Ingestor) Retry(ctx context.Context, course api.Course) error {
	updated, err := i.repository.Update(ctx, course.ID, MarkIngestRunning)
	if err != nil {
		return fmt.Errorf("reset draft for retry: %w", err)
	}
	if err := i.start(ctx, updated); err != nil {
		i.fail(ctx, updated.ID, "Ingestion could not be started.")
		return err
	}
	return nil
}

func (i *Ingestor) start(ctx context.Context, course api.Course) error {
	err := i.runtime.StartIngestion(ctx, IngestionInput{
		CourseID:       course.ID,
		SpecialistName: course.SpecialistName,
		Title:          course.Title,
		Tagline:        course.Tagline,
		SourceText:     course.SourceText,
		SourceFiles:    course.SourceFiles,
	})
	if err != nil {
		return err
	}
	i.Watch(course.ID)
	return nil
}

// Watch persists the outcome of a run, in the background, forever.
//
// It runs on a context of its own rather than the request's: the request ends when the
// tab closes and the run does not. Without this, closing the tab thirty seconds into a
// two-minute ingestion would leave a course stuck in "running" with a finished workflow
// nobody ever read.
func (i *Ingestor) Watch(courseID string) {
	go func() {
		// Bounded so a wedged run cannot pin a goroutine for the life of the process.
		// The bound is generous: it only has to outlast the workflow's own timeout.
		ctx, cancel := context.WithTimeout(context.Background(), i.maxStream)
		defer cancel()

		result, err := i.runtime.AwaitResult(ctx, courseID)
		if err != nil {
			message := ingestFailureMessage(err)
			i.logger.Warn(
				"ingestion failed", "course_id", courseID, "error", err, "detail", message,
			)
			i.fail(ctx, courseID, message)
			return
		}
		if _, err := i.repository.Update(ctx, courseID, func(course api.Course) api.Course {
			return ApplyIngestResult(course, result)
		}); err != nil {
			i.logger.Error("could not persist ingestion result", "course_id", courseID, "error", err)
			return
		}
		i.logger.Info(
			"ingestion completed",
			"course_id", courseID,
			"lessons", len(result.Lessons),
			"positions", len(result.Positions),
		)
	}()
}

// Reconcile re-attaches a watcher to every run that was in flight when this process
// started. A deploy or a crash mid-ingestion would otherwise strand those drafts in
// "running" with nobody left to save them.
func (i *Ingestor) Reconcile(ctx context.Context) error {
	running, err := i.repository.ListRunning(ctx)
	if err != nil {
		return fmt.Errorf("list running ingestions: %w", err)
	}
	for _, courseID := range running {
		i.logger.Info("re-attaching to an in-flight ingestion", "course_id", courseID)
		i.Watch(courseID)
	}
	return nil
}

func (i *Ingestor) fail(ctx context.Context, courseID, message string) {
	// WithoutCancel: this is the error path, and it is usually reached because the
	// context that got us here is already dead.
	if _, err := i.repository.Update(
		context.WithoutCancel(ctx), courseID,
		func(course api.Course) api.Course { return MarkIngestFailed(course, message) },
	); err != nil {
		i.logger.Error("could not record ingestion failure", "course_id", courseID, "error", err)
	}
}

// Stream emits the server-sent events the ingestion panel renders, until the run
// reaches a terminal state or the caller goes away.
//
// It reads status lines from the workflow but terminal state from the database, and the
// asymmetry is deliberate: the watcher is what writes lessons, so a "ready" from the
// workflow query can arrive before those lessons exist. Trusting the row means the
// client is never redirected to a review screen that has nothing on it yet.
func (i *Ingestor) Stream(
	ctx context.Context, courseID string, emit func(api.IngestEvent),
) {
	// The draft id goes out before anything can fail, so a client that sees only this
	// frame still knows which course to retry.
	emit(api.IngestEvent{Type: "draft", CourseID: courseID})

	deadline := i.now().Add(i.maxStream)
	sent := 0
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		if progress, err := i.runtime.Progress(ctx, courseID); err == nil {
			for _, line := range progress.Lines[min(sent, len(progress.Lines)):] {
				emit(api.IngestEvent{Type: "status", Message: line})
			}
			sent = len(progress.Lines)
		} else if !errors.Is(err, ErrRunNotFound) {
			// A query that fails is not fatal: the run is durable and the row below is
			// the authority. Losing a status line is cosmetic.
			i.logger.Debug("ingest progress query failed", "course_id", courseID, "error", err)
		}

		course, err := i.repository.Get(ctx, courseID)
		if err != nil {
			emit(api.IngestEvent{
				Type:     "error",
				Code:     "ingest_failed",
				Message:  "The draft could not be read.",
				CourseID: courseID,
			})
			return
		}
		switch course.IngestStatus {
		case api.IngestReady:
			emit(api.IngestEvent{Type: "result", CourseID: courseID})
			return
		case api.IngestFailed:
			emit(api.IngestEvent{
				Type:     "error",
				Code:     "ingest_failed",
				Message:  fallback(course.IngestError, "Ingestion failed."),
				CourseID: courseID,
			})
			return
		}

		if !i.now().Before(deadline) {
			emit(api.IngestEvent{
				Type: "error",
				Code: "ingest_timeout",
				Message: "This is taking longer than expected. The draft is saved — " +
					"reopen it to see where it got to.",
				CourseID: courseID,
			})
			return
		}

		select {
		case <-ctx.Done():
			// The tab closed. The run continues and the watcher will still save it.
			return
		case <-ticker.C:
		}
	}
}

// ingestFailureMessage turns a workflow error into something a Specialist can read.
//
// An ApplicationError's message is ours — the graph raises it with a sentence written
// for this screen — so it is passed through. Anything else is infrastructure detail
// that would only confuse the person who dropped the files.
func ingestFailureMessage(err error) string {
	if errors.Is(err, ErrRunNotFound) {
		return "The ingestion run could not be found. Retry to start a new one."
	}
	var applicationError *temporal.ApplicationError
	if errors.As(err, &applicationError) && applicationError.Message() != "" {
		return applicationError.Message()
	}
	var timeoutError *temporal.TimeoutError
	if errors.As(err, &timeoutError) {
		return "Ingestion ran out of time. The draft is saved — retry when you're ready."
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "Ingestion stopped before it finished. The draft is saved — retry when you're ready."
	}
	return "Ingestion failed. The draft is saved — retry when you're ready."
}

func fallback(value, whenEmpty string) string {
	if value == "" {
		return whenEmpty
	}
	return value
}
