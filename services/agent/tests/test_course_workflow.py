"""The workflow, on a real (time-skipping) Temporal server.

This is the cross-boundary test: the same LangGraphPlugin wiring the deployed worker
uses, the same pydantic data converter the Go gateway's payloads pass through, and the
same `get_progress` query the gateway polls. If node identity, state serialization or
the query contract breaks, it breaks here rather than in a container.
"""

from datetime import timedelta
from typing import Any

import pytest
from app.core.course_schemas import (
    IngestProgress,
    IngestProgressStatus,
    IngestRequest,
    IngestResult,
    SoftenRequest,
    SoftenResult,
)
from app.core.ingest_model import FixtureIngestionModel
from app.core.settings import Settings
from app.graph.anchors import is_quote_anchored
from app.graph.ingest import IngestNodes, build_ingest_graph
from app.graph.soften import SoftenNodes, build_soften_graph
from app.temporal.course_workflow import (
    INGEST_GRAPH,
    QUERY_GET_PROGRESS,
    SOFTEN_GRAPH,
    CourseIngestionWorkflow,
    SoftenClaimWorkflow,
)
from temporalio.client import Client, WorkflowFailureError
from temporalio.contrib.langgraph import LangGraphPlugin
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker


def ingest_request(source_text: str) -> IngestRequest:
    return IngestRequest(
        course_id="course-workflow-test",
        specialist_name="Dana Mercado",
        title="Hold Your Number",
        tagline="The deal is won or lost long before anyone says a price.",
        source_text=source_text,
        source_files=["source.md"],
    )


async def test_a_run_returns_the_course_the_gateway_persists(
    ingest_worker: Client, task_queue: str, source_text: str, expected: dict[str, Any]
) -> None:
    result = await ingest_worker.execute_workflow(
        CourseIngestionWorkflow.run,
        ingest_request(source_text),
        id="ingest-course-workflow-test",
        task_queue=task_queue,
    )

    assert isinstance(result, IngestResult)
    assert len(result.lessons) == len(expected["lessons"])
    assert len(result.positions) == len(expected["positions"])
    # Ordinals are assigned by the graph and reassigned by the gateway; both must agree
    # that they are 1..n in order.
    assert [lesson.ord for lesson in result.lessons] == list(range(1, len(result.lessons) + 1))
    assert result.voice_card.register
    # A2, surviving the whole round trip through Temporal's payload converter.
    assert all(is_quote_anchored(position.quote, source_text) for position in result.positions)


async def test_progress_is_queryable_while_a_run_is_open_and_after_it_closes(
    ingest_worker: Client, task_queue: str, source_text: str
) -> None:
    """The query the gateway's SSE stream polls.

    Queries work against closed workflows too, which is what lets a client that
    reconnects after a run finished still receive the whole list rather than an error.
    """

    handle = await ingest_worker.start_workflow(
        CourseIngestionWorkflow.run,
        ingest_request(source_text),
        id="ingest-course-progress-test",
        task_queue=task_queue,
    )
    await handle.result()

    # Queried by name with an explicit result type, which is what the Go gateway does
    # from the other side of the wire — it decodes the same JSON into api.IngestProgress.
    progress = await handle.query(QUERY_GET_PROGRESS, result_type=IngestProgress)

    assert isinstance(progress, IngestProgress)
    assert progress.status is IngestProgressStatus.READY
    assert progress.lines, "the panel would have nothing to render"
    assert any(line.startswith("READING ") for line in progress.lines)
    assert any(line.startswith("WRITING LESSON ") for line in progress.lines)
    # Append-only and never rewritten: the gateway tracks its position by count, so a
    # repeated line would replay on the Specialist's screen.
    assert len(progress.lines) == len(set(progress.lines))


async def test_a_failing_node_fails_the_run_so_the_draft_becomes_retryable(
    temporal_env: WorkflowEnvironment,
    settings: Settings,
    model: FixtureIngestionModel,
    task_queue: str,
) -> None:
    """The gateway turns a workflow failure into a failed draft with [RETRY INGESTION].
    That only works if the failure actually propagates out of the graph."""

    class BrokenModel(FixtureIngestionModel):
        async def plan_lessons(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            raise RuntimeError("the model is unreachable")

    nodes = IngestNodes(settings=settings, model=BrokenModel(model.fixture_dir))

    async with Worker(
        temporal_env.client,
        task_queue=task_queue,
        workflows=[CourseIngestionWorkflow],
        plugins=[LangGraphPlugin(graphs={INGEST_GRAPH: build_ingest_graph(nodes)})],
    ):
        with pytest.raises(WorkflowFailureError):
            await temporal_env.client.execute_workflow(
                CourseIngestionWorkflow.run,
                ingest_request("# SOURCE FILE: a.md\n\n" + "material. " * 50),
                id="ingest-course-broken-test",
                task_queue=task_queue,
                # Without this the node's own retry policy would spend three attempts
                # failing before the run closes, and the test would just be slow.
                execution_timeout=timedelta(seconds=30),
            )


async def test_soften_rewrites_a_claim_without_a_model_client_in_go(
    temporal_env: WorkflowEnvironment, model: FixtureIngestionModel, task_queue: str
) -> None:
    async with Worker(
        temporal_env.client,
        task_queue=task_queue,
        workflows=[SoftenClaimWorkflow],
        plugins=[LangGraphPlugin(graphs={SOFTEN_GRAPH: build_soften_graph(SoftenNodes(model))})],
    ):
        result = await temporal_env.client.execute_workflow(
            SoftenClaimWorkflow.run,
            SoftenRequest(claim="Never bill hourly, ever."),
            id="soften-test",
            task_queue=task_queue,
        )

    assert isinstance(result, SoftenResult)
    # Softened, not retreated: the edge survives, the universal does not.
    assert result.claim != "Never bill hourly, ever."
    assert "Never" not in result.claim
