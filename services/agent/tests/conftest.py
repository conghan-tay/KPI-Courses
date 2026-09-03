import json
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from app.core.ingest_model import FixtureIngestionModel
from app.core.settings import Settings, get_settings
from app.graph.ingest import SOURCE_HEADER, IngestNodes, build_ingest_graph
from app.graph.rephrase import RephraseNodes, build_rephrase_graph
from app.temporal.kb_workflow import (
    INGEST_GRAPH,
    REPHRASE_GRAPH,
    KnowledgeBaseIngestionWorkflow,
    RephraseChipWorkflow,
)
from temporalio.client import Client
from temporalio.contrib.langgraph import LangGraphPlugin
from temporalio.contrib.pydantic import pydantic_data_converter
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

TASK_QUEUE = "kb-ingest-test"

# The tests read the real fixture rather than a hand-made stand-in. That is the point:
# assertion B2 is "every reference resolves to a section that exists", and a fake
# knowledge base would make it pass while proving nothing.
FIXTURE_DIR = Path(__file__).resolve().parents[3] / "docs" / "productDocs" / "fixtures"

# The seven documents that make up the reference corpus, in the order the dropzone sends
# them. resume.md is first because its frontmatter is what autofills the form.
FIXTURE_FILES = [
    "resume.md",
    "agoda-supplier-payouts.md",
    "agoda-psp-routing.md",
    "agoda-reconciliation.md",
    "postgres-notes.md",
    "nodusart-advisory.md",
    "career-notes.md",
]


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
def source_files() -> list[str]:
    return list(FIXTURE_FILES)


@pytest.fixture(scope="session")
def source_text() -> str:
    """The seven fixture documents, concatenated the way the web app concatenates them.

    joinCorpus in services/web/lib/extract.ts writes this exact header before each
    upload, and `split_corpus` splits on it — so building the corpus here the same way
    is what makes the read loop run seven times in a test rather than once.
    """

    return "\n\n---\n\n".join(
        f"{SOURCE_HEADER}{name}\n\n{(FIXTURE_DIR / name).read_text(encoding='utf-8')}"
        for name in FIXTURE_FILES
    )


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
        workflows=[KnowledgeBaseIngestionWorkflow, RephraseChipWorkflow],
        plugins=[
            LangGraphPlugin(
                graphs={
                    INGEST_GRAPH: build_ingest_graph(nodes),
                    REPHRASE_GRAPH: build_rephrase_graph(RephraseNodes(model)),
                }
            )
        ],
    ):
        yield temporal_env.client
