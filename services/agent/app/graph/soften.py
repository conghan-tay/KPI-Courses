"""`Soften` on a position card, as a one-node graph.

POC_UserJourney.md gives the review screen `Keep`, `Soften`, `Delete`. Softening only
means anything with a model behind it, and the model lives on this side of the Temporal
boundary — so it is a graph, so it gets the same retry policy, the same provider
selection and the same fake-model mode as everything else.
"""

from datetime import timedelta
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from temporalio.common import RetryPolicy

from ..core.ingest_model import IngestionModel


class SoftenState(TypedDict, total=False):
    claim: str


SOFTEN_NODE: dict[str, Any] = {
    "execute_in": "activity",
    "start_to_close_timeout": timedelta(seconds=60),
    "retry_policy": RetryPolicy(maximum_attempts=2),
}


class SoftenNodes:
    """A method rather than a closure: the Temporal plugin identifies nodes by qualname
    and rejects lambdas."""

    def __init__(self, model: IngestionModel) -> None:
        self._model = model

    async def soften(self, state: SoftenState) -> dict[str, Any]:
        claim = state.get("claim", "")
        if not claim.strip():
            return {"claim": claim}
        return {"claim": await self._model.soften_claim(claim)}


def build_soften_graph(nodes: SoftenNodes) -> StateGraph:
    builder = StateGraph(SoftenState)
    builder.add_node("soften", nodes.soften, metadata=SOFTEN_NODE)
    builder.add_edge(START, "soften")
    builder.add_edge("soften", END)
    return builder
