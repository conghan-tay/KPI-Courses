"""Getting a status line out of a running graph and onto the Specialist's screen.

The ingestion panel shows a live line of `meta` status and no percentage, because a run
has no honest midpoint. Producing that line is harder than it looks: the graph's nodes
execute as Temporal *activities*, in a different context from the workflow the gateway
queries, so a node cannot simply write to workflow state.

So a node reports, an activity-side reporter signals the workflow that started it, and
the workflow accumulates the lines its `get_progress` query returns. Signals are
recorded in the event history, which means the accumulated list survives a worker
restart and replays deterministically.

The alternative — streaming state updates out of the graph — depends on how much of
LangGraph's streaming API the Temporal plugin forwards. This depends only on signals,
which are the oldest and most boring thing Temporal does.
"""

from abc import ABC, abstractmethod

import structlog
from temporalio import activity
from temporalio.client import Client

logger = structlog.get_logger(__name__)

# The workflow's signal handler. Must match SIGNAL_ADD_PROGRESS in
# app/temporal/course_workflow.py.
SIGNAL_ADD_PROGRESS = "add_progress"


class ProgressReporter(ABC):
    """Somewhere for a node to say what it is doing."""

    @abstractmethod
    async def report(self, line: str) -> None: ...


class NullProgressReporter(ProgressReporter):
    """Used by unit tests and by any run with no workflow behind it."""

    async def report(self, line: str) -> None:
        return None


class TemporalProgressReporter(ProgressReporter):
    """Signals the workflow that scheduled the running activity."""

    def __init__(self, client: Client) -> None:
        self._client = client

    async def report(self, line: str) -> None:
        try:
            info = activity.info()
        except RuntimeError:
            # Not inside an activity — a node being exercised directly by a test, or a
            # node the plugin chose to run inline in the workflow.
            return
        try:
            handle = self._client.get_workflow_handle(info.workflow_id, run_id=info.workflow_run_id)
            await handle.signal(SIGNAL_ADD_PROGRESS, line)
        except Exception as exc:  # noqa: BLE001
            # A status line is cosmetic. Losing one must never fail an activity and cost
            # the Specialist a retry of real work.
            logger.warning("progress_signal_failed", line=line, error=str(exc))
