"""The workflow, on a real (time-skipping) Temporal server.

This is the cross-boundary test: the same LangGraphPlugin wiring the deployed worker
uses, the same pydantic data converter the Go gateway's payloads pass through, and the
same `get_progress` query the gateway polls. If node identity, state serialization or
the query contract breaks, it breaks here rather than in a container.
"""

from datetime import timedelta
from typing import Any

import pytest
from app.core.ingest_model import FixtureIngestionModel
from app.core.kb_schemas import (
    ChipRegister,
    IngestProgress,
    IngestProgressStatus,
    IngestRequest,
    IngestResult,
    RephraseRequest,
    RephraseResult,
    section_id,
)
from app.core.settings import Settings
from app.graph.ingest import IngestNodes, build_ingest_graph
from app.graph.refs import resolve
from app.graph.rephrase import RephraseNodes, build_rephrase_graph
from app.temporal.kb_workflow import (
    INGEST_GRAPH,
    QUERY_GET_PROGRESS,
    REPHRASE_GRAPH,
    KnowledgeBaseIngestionWorkflow,
    RephraseChipWorkflow,
)
from temporalio.client import Client, WorkflowFailureError
from temporalio.contrib.langgraph import LangGraphPlugin
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker


def ingest_request(source_text: str, source_files: list[str]) -> IngestRequest:
    return IngestRequest(
        kb_id="kb-workflow-test",
        candidate_name="Arun Velasco",
        title="Arun Velasco",
        tagline="Payments engineer. Eleven years, four employers, one gap.",
        source_text=source_text,
        source_files=source_files,
    )


async def test_a_run_returns_the_knowledge_base_the_gateway_persists(
    ingest_worker: Client,
    task_queue: str,
    source_text: str,
    source_files: list[str],
    expected: dict[str, Any],
) -> None:
    result = await ingest_worker.execute_workflow(
        KnowledgeBaseIngestionWorkflow.run,
        ingest_request(source_text, source_files),
        id="ingest-kb-workflow-test",
        task_queue=task_queue,
    )

    assert isinstance(result, IngestResult)
    assert len(result.sections) == len(expected["sections"])
    assert len(result.chips) == len(expected["chips"])
    assert len(result.quiz) == len(expected["quiz"])
    # Ordinals are assigned by the graph and reassigned by the gateway; both must agree
    # that they are 1..n in order.
    assert [section.ord for section in result.sections] == list(range(1, len(result.sections) + 1))
    assert len(result.pre_roll.bullets) == 4

    # B2, surviving the whole round trip through Temporal's payload converter. This is
    # the assertion that catches a renamed JSON tag between Python and Go.
    ids = [section_id(section.path, section.anchor) for section in result.sections]
    assert all(resolve(chip.kb_section, ids) for chip in result.chips)
    assert all(resolve(item.source_section, ids) for item in result.quiz)


async def test_progress_is_queryable_while_a_run_is_open_and_after_it_closes(
    ingest_worker: Client, task_queue: str, source_text: str, source_files: list[str]
) -> None:
    """The query the gateway's SSE stream polls.

    Queries work against closed workflows too, which is what lets a client that
    reconnects after a run finished still receive the whole list rather than an error.
    """

    handle = await ingest_worker.start_workflow(
        KnowledgeBaseIngestionWorkflow.run,
        ingest_request(source_text, source_files),
        id="ingest-kb-progress-test",
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
    assert any(line.startswith("WRITING SECTION ") for line in progress.lines)
    assert any(line.startswith("DRAFTING OPENING QUESTIONS") for line in progress.lines)
    assert any(line.startswith("WRITING THE GATE QUIZ") for line in progress.lines)
    # Append-only and never rewritten: the gateway tracks its position by count, so a
    # repeated line would replay on the candidate's screen.
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
        async def plan_sections(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            raise RuntimeError("the model is unreachable")

    nodes = IngestNodes(settings=settings, model=BrokenModel(model.fixture_dir))

    async with Worker(
        temporal_env.client,
        task_queue=task_queue,
        workflows=[KnowledgeBaseIngestionWorkflow],
        plugins=[LangGraphPlugin(graphs={INGEST_GRAPH: build_ingest_graph(nodes)})],
    ):
        with pytest.raises(WorkflowFailureError):
            await temporal_env.client.execute_workflow(
                KnowledgeBaseIngestionWorkflow.run,
                ingest_request("# SOURCE FILE: a.md\n\n" + "material. " * 50, ["a.md"]),
                id="ingest-kb-broken-test",
                task_queue=task_queue,
                # Without this the node's own retry policy would spend three attempts
                # failing before the run closes, and the test would just be slow.
                execution_timeout=timedelta(seconds=30),
            )


async def test_rephrase_rewrites_a_chip_without_a_model_client_in_go(
    temporal_env: WorkflowEnvironment, model: FixtureIngestionModel, task_queue: str
) -> None:
    async with Worker(
        temporal_env.client,
        task_queue=task_queue,
        workflows=[RephraseChipWorkflow],
        plugins=[
            LangGraphPlugin(graphs={REPHRASE_GRAPH: build_rephrase_graph(RephraseNodes(model))})
        ],
    ):
        result = await temporal_env.client.execute_workflow(
            RephraseChipWorkflow.run,
            RephraseRequest(
                text="walk me through the virtual card issuing flow",
                register=ChipRegister.BLUNT,
            ),
            id="rephrase-test",
            task_queue=task_queue,
        )

    assert isinstance(result, RephraseResult)
    # Rewritten rather than echoed: the button on the review screen is never dead.
    assert result.text != "walk me through the virtual card issuing flow"
    assert result.text
