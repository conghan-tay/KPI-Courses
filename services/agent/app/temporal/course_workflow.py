"""The durable course-ingestion workflow.

Temporal owns everything that would otherwise need a checkpointer database: each graph
step is persisted in the workflow's event history, a run survives worker restarts and
deploys, and the gateway can attach to a run it did not start — which is what lets a
closed browser tab not lose a finished course.
"""

from typing import Any

from temporalio import workflow

# Passthrough imports reuse the modules the worker process already loaded rather than
# re-importing them inside the workflow sandbox, which both speeds up workflow startup
# and avoids the sandbox rejecting LangGraph's own imports. Nothing imported here may
# read the filesystem, the clock, or the environment at call time.
with workflow.unsafe.imports_passed_through():
    from langgraph.checkpoint.memory import InMemorySaver
    from temporalio.contrib.langgraph import graph as temporal_graph

    from ..core.course_schemas import (
        IngestProgress,
        IngestProgressStatus,
        IngestRequest,
        IngestResult,
        Lesson,
        Position,
        SoftenRequest,
        SoftenResult,
        VoiceCard,
    )

INGEST_GRAPH = "ingest"
SOFTEN_GRAPH = "soften"

# The Go gateway addresses these by name over gRPC and has no access to this module.
# Renaming any of them is a breaking API change; see
# services/gateway/internal/courses/runtime.go.
WORKFLOW_INGEST = "CourseIngestionWorkflow"
WORKFLOW_SOFTEN = "SoftenClaimWorkflow"
QUERY_GET_PROGRESS = "get_progress"
SIGNAL_ADD_PROGRESS = "add_progress"


@workflow.defn(name=WORKFLOW_INGEST)
class CourseIngestionWorkflow:
    def __init__(self) -> None:
        self._progress = IngestProgress()

    @workflow.query(name=QUERY_GET_PROGRESS)
    def get_progress(self) -> IngestProgress:
        """Serve the gateway's SSE poll.

        Queries also work against closed workflows, so a client that reconnects after a
        run finished still gets the whole list rather than an error.
        """

        return self._progress

    @workflow.signal(name=SIGNAL_ADD_PROGRESS)
    async def add_progress(self, line: str) -> None:
        """Receive a status line from a node running as an activity.

        Activities are at-least-once: a retried node reports again. The gateway tracks
        which lines it has forwarded by count, so a duplicate would replay a line on the
        Specialist's screen. Dropping a repeat of the line we just recorded costs
        nothing and removes that flicker.
        """

        if not line or (self._progress.lines and self._progress.lines[-1] == line):
            return
        self._progress.lines.append(line)

    @workflow.run
    async def run(self, request: IngestRequest) -> IngestResult:
        """Turn one Specialist's raw material into a course.

        The result is returned rather than written anywhere: this process has no
        database. The gateway waits on it and persists — see
        services/gateway/internal/courses/ingest.go.
        """

        workflow.logger.info(
            "ingestion starting",
            extra={"course_id": request.course_id, "files": len(request.source_files)},
        )

        # Temporal supplies durability, so the graph only needs an in-memory saver.
        # Nothing here is written to an application database.
        app = temporal_graph(INGEST_GRAPH).compile(checkpointer=InMemorySaver())
        config: dict[str, Any] = {"configurable": {"thread_id": request.course_id}}

        try:
            result = await app.ainvoke(
                {
                    "course_id": request.course_id,
                    "specialist_name": request.specialist_name,
                    "title": request.title,
                    "tagline": request.tagline,
                    "source_text": request.source_text,
                    "source_files": request.source_files,
                },
                config,
                version="v2",
            )
        except Exception:
            # The failure itself propagates to the gateway, which turns it into the
            # retryable draft state. Recording it here as well means a client polling
            # the query sees why, not just that the lines stopped.
            self._progress.status = IngestProgressStatus.FAILED
            self._progress.error = "Ingestion failed."
            raise

        values = result.value
        ingested = IngestResult(
            lessons=[Lesson.model_validate(row) for row in values.get("lessons", [])],
            positions=[Position.model_validate(row) for row in values.get("positions", [])],
            voice_card=VoiceCard.model_validate(values.get("voice_card") or {}),
        )

        # Any line a signal missed — a node the plugin ran inline in the workflow rather
        # than as an activity reports nothing — is backfilled from the graph's own state
        # before the run closes, so a late poller sees the full history.
        for line in values.get("status_lines", []):
            await self.add_progress(line)
        self._progress.status = IngestProgressStatus.READY

        workflow.logger.info(
            "ingestion finished",
            extra={
                "course_id": request.course_id,
                "lessons": len(ingested.lessons),
                "positions": len(ingested.positions),
            },
        )
        return ingested


@workflow.defn(name=WORKFLOW_SOFTEN)
class SoftenClaimWorkflow:
    """`Soften` on a position card.

    A workflow for one small rewrite looks like overkill, and it is — until you notice
    the alternative is a model client inside the Go gateway. Keeping every model call on
    this side of the Temporal boundary means one place holds provider credentials, one
    place has retry policy, and the fake-model mode covers this button too.
    """

    @workflow.run
    async def run(self, request: SoftenRequest) -> SoftenResult:
        app = temporal_graph(SOFTEN_GRAPH).compile()
        result = await app.ainvoke({"claim": request.claim}, version="v2")
        return SoftenResult(claim=result.value.get("claim") or request.claim)
