"""`Rephrase` on a chip card, as a one-node graph.

POC_UserJourney.md gives the review screen `Select`, `Rephrase`, `Delete`. Rephrasing
only means anything with a model behind it, and the model lives on this side of the
Temporal boundary — so it is a graph, so it gets the same retry policy, the same provider
selection and the same fake-model mode as everything else.
"""

from datetime import timedelta
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from temporalio.common import RetryPolicy

from ..core.ingest_model import IngestionModel
from ..core.kb_schemas import ChipRegister


class RephraseState(TypedDict, total=False):
    text: str
    register: str


REPHRASE_NODE: dict[str, Any] = {
    "execute_in": "activity",
    "start_to_close_timeout": timedelta(seconds=60),
    "retry_policy": RetryPolicy(maximum_attempts=2),
}


class RephraseNodes:
    """A method rather than a closure: the Temporal plugin identifies nodes by qualname
    and rejects lambdas."""

    def __init__(self, model: IngestionModel) -> None:
        self._model = model

    async def rephrase(self, state: RephraseState) -> dict[str, Any]:
        text = state.get("text", "")
        if not text.strip():
            return {"text": text}
        # An unrecognised register is the caller's bug, not the candidate's problem: fall
        # back to the neutral one rather than failing a button press.
        try:
            register = ChipRegister(state.get("register") or ChipRegister.NARRATIVE)
        except ValueError:
            register = ChipRegister.NARRATIVE
        return {"text": await self._model.rephrase_chip(text, register)}


def build_rephrase_graph(nodes: RephraseNodes) -> StateGraph:
    builder = StateGraph(RephraseState)
    builder.add_node("rephrase", nodes.rephrase, metadata=REPHRASE_NODE)
    builder.add_edge(START, "rephrase")
    builder.add_edge("rephrase", END)
    return builder
