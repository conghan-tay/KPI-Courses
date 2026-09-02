"""Getting a status line from a node to the ingestion panel.

Three hops have to work: a node reports, the activity-side reporter signals the workflow
that scheduled it, and the workflow accumulates the lines its query returns. The
end-to-end workflow test proves the lines are *there* by the time a run closes, but the
workflow also backfills from graph state at the end — so that test would still pass with
the live path completely broken, and nobody would notice until a candidate watched a
blank panel for two minutes.
"""

from typing import Any

import pytest
from app.core.kb_schemas import IngestProgress
from app.graph.progress import (
    SIGNAL_ADD_PROGRESS,
    NullProgressReporter,
    TemporalProgressReporter,
)
from app.temporal.kb_workflow import KnowledgeBaseIngestionWorkflow


class FakeHandle:
    def __init__(self, signals: list[tuple[str, str]]) -> None:
        self._signals = signals

    async def signal(self, name: str, argument: str) -> None:
        self._signals.append((name, argument))


class FakeClient:
    def __init__(self) -> None:
        self.signals: list[tuple[str, str]] = []
        self.handles: list[tuple[str, str]] = []

    def get_workflow_handle(self, workflow_id: str, run_id: str | None = None) -> FakeHandle:
        self.handles.append((workflow_id, run_id or ""))
        return FakeHandle(self.signals)


class FakeInfo:
    workflow_id = "ingest-kb-1"
    workflow_run_id = "run-1"


async def test_a_reporter_outside_an_activity_is_a_no_op(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Nodes get exercised directly by tests, and the plugin may run one inline in the
    workflow. Neither has an activity context, and neither should blow up."""

    client = FakeClient()

    await TemporalProgressReporter(client).report("READING 1 OF 3 FILES · a.md")  # type: ignore[arg-type]

    assert client.signals == []


async def test_a_node_signals_the_workflow_that_scheduled_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = FakeClient()
    monkeypatch.setattr("app.graph.progress.activity.info", lambda: FakeInfo())

    await TemporalProgressReporter(client).report("DRAFTING OPENING QUESTIONS · 8 FOUND")  # type: ignore[arg-type]

    assert client.handles == [("ingest-kb-1", "run-1")]
    assert client.signals == [(SIGNAL_ADD_PROGRESS, "DRAFTING OPENING QUESTIONS · 8 FOUND")]


async def test_a_failed_signal_never_fails_the_activity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A status line is cosmetic. Losing one must not cost the candidate a retry of a
    two-minute section generation."""

    class BrokenClient(FakeClient):
        def get_workflow_handle(self, workflow_id: str, run_id: str | None = None) -> Any:
            raise RuntimeError("temporal is unreachable")

    monkeypatch.setattr("app.graph.progress.activity.info", lambda: FakeInfo())

    await TemporalProgressReporter(BrokenClient()).report("WRITING THE PRE-ROLL…")  # type: ignore[arg-type]


async def test_the_null_reporter_accepts_anything() -> None:
    await NullProgressReporter().report("anything")


async def test_the_workflow_drops_a_repeated_line() -> None:
    """Activities are at-least-once, so a retried node reports again. The gateway tracks
    its position in the list by count, so a duplicate would replay a line on screen."""

    workflow = KnowledgeBaseIngestionWorkflow()

    await workflow.add_progress("READING 1 OF 3 FILES · a.md")
    await workflow.add_progress("READING 1 OF 3 FILES · a.md")
    await workflow.add_progress("READING 2 OF 3 FILES · b.md")
    await workflow.add_progress("")

    progress = workflow.get_progress()
    assert isinstance(progress, IngestProgress)
    assert progress.lines == [
        "READING 1 OF 3 FILES · a.md",
        "READING 2 OF 3 FILES · b.md",
    ]


async def test_a_line_that_recurs_later_is_kept() -> None:
    """Only an immediate repeat is a retry. The same words arriving again after other
    work is a real second event — the verify/repair loop runs twice, say — and dropping
    it would leave a gap in the panel."""

    workflow = KnowledgeBaseIngestionWorkflow()

    await workflow.add_progress("CHECKING SECTION REFERENCES…")
    await workflow.add_progress("WRITING THE PRE-ROLL…")
    await workflow.add_progress("CHECKING SECTION REFERENCES…")

    assert len(workflow.get_progress().lines) == 3
