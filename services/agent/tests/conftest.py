import json
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from app.core.ingest_model import FixtureIngestionModel
from app.core.settings import Settings, get_settings
from app.graph.ingest import IngestNodes, build_ingest_graph
from app.graph.soften import SoftenNodes, build_soften_graph
from app.temporal.course_workflow import (
    INGEST_GRAPH,
    SOFTEN_GRAPH,
    CourseIngestionWorkflow,
    SoftenClaimWorkflow,
)
from temporalio.client import Client
from temporalio.contrib.langgraph import LangGraphPlugin
from temporalio.contrib.pydantic import pydantic_data_converter
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

TASK_QUEUE = "course-ingest-test"

# The tests read the real fixture rather than a hand-made stand-in. That is the point:
# assertion A2 is "every quote appears verbatim in source.md", and a fake source file
# would make it pass while proving nothing.
FIXTURE_DIR = Path(__file__).resolve().parents[3] / "docs" / "productDocs" / "fixtures"


@pytest.fixture
def task_queue() -> str:
    return TASK_QUEUE


@pytest.fixture(autouse=True)
def test_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("MODEL_PROVIDER", "fake")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def settings() -> Settings:
    return Settings(model_provider="fake", fixture_dir=str(FIXTURE_DIR))


@pytest.fixture(scope="session")
def expected() -> dict[str, Any]:
    """docs/productDocs/fixtures/expected.json — the reference ingestion output."""

    return json.loads((FIXTURE_DIR / "expected.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def source_text() -> str:
    """docs/productDocs/fixtures/source.md — the corpus every quote must be found in."""

    return (FIXTURE_DIR / "source.md").read_text(encoding="utf-8")


@pytest.fixture
def model() -> FixtureIngestionModel:
    return FixtureIngestionModel(str(FIXTURE_DIR))


@pytest.fixture
def nodes(settings: Settings, model: FixtureIngestionModel) -> IngestNodes:
    """Nodes with the fixture model and no reporter.

    The reporter defaults to the null one, so a node exercised on its own does not try
    to signal a workflow that is not there.
    """

    return IngestNodes(settings=settings, model=model)


@pytest_asyncio.fixture
async def temporal_env() -> AsyncIterator[WorkflowEnvironment]:
    async with await WorkflowEnvironment.start_time_skipping(
        data_converter=pydantic_data_converter
    ) as env:
        yield env


@pytest_asyncio.fixture
async def ingest_worker(
    temporal_env: WorkflowEnvironment,
    nodes: IngestNodes,
    model: FixtureIngestionModel,
) -> AsyncIterator[Client]:
    """Run the real worker wiring — same plugin and graphs the deployed worker uses."""

    async with Worker(
        temporal_env.client,
        task_queue=TASK_QUEUE,
        workflows=[CourseIngestionWorkflow, SoftenClaimWorkflow],
        plugins=[
            LangGraphPlugin(
                graphs={
                    INGEST_GRAPH: build_ingest_graph(nodes),
                    SOFTEN_GRAPH: build_soften_graph(SoftenNodes(model)),
                }
            )
        ],
    ):
        yield temporal_env.client
