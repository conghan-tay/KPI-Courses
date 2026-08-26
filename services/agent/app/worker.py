"""Temporal worker entrypoint: `python -m app.worker`.

This process has no HTTP server and no database. It polls a Temporal task queue,
executes the LangGraph nodes registered below as activities, and returns a course to
whoever started the run. The public API and all persistence live in the Go gateway.
"""

import asyncio
import contextlib
import signal

import structlog
from temporalio.contrib.langgraph import LangGraphPlugin
from temporalio.worker import Worker

from .core.ingest_model import build_ingestion_model
from .core.logging import configure_logging
from .core.settings import get_settings
from .graph.ingest import IngestNodes, build_ingest_graph
from .graph.progress import TemporalProgressReporter
from .graph.soften import SoftenNodes, build_soften_graph
from .temporal.client import connect
from .temporal.course_workflow import (
    INGEST_GRAPH,
    SOFTEN_GRAPH,
    CourseIngestionWorkflow,
    SoftenClaimWorkflow,
)

logger = structlog.get_logger(__name__)


async def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)

    client = await connect(settings)

    # Built once, here, so every node keeps a live reference to the model. Activities
    # run in this same process, so no dependency has to cross a serialization boundary.
    #
    # The reporter takes the same client the worker polls with: a node running as an
    # activity signals the workflow that scheduled it, which is how a status line gets
    # from a graph step to the ingestion panel. See app/graph/progress.py.
    model = build_ingestion_model(settings)
    ingest_nodes = IngestNodes(
        settings=settings,
        model=model,
        progress=TemporalProgressReporter(client),
    )
    soften_nodes = SoftenNodes(model)

    worker = Worker(
        client,
        task_queue=settings.temporal_task_queue,
        workflows=[CourseIngestionWorkflow, SoftenClaimWorkflow],
        plugins=[
            LangGraphPlugin(
                graphs={
                    INGEST_GRAPH: build_ingest_graph(ingest_nodes),
                    SOFTEN_GRAPH: build_soften_graph(soften_nodes),
                }
            )
        ],
    )

    logger.info(
        "worker_starting",
        address=settings.temporal_address,
        namespace=settings.temporal_namespace,
        task_queue=settings.temporal_task_queue,
        model_provider=settings.model_provider,
        model_name=settings.model_name,
    )

    # Drain in-flight tasks on SIGTERM so a deploy does not abandon a running ingestion.
    shutdown = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signal_name in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(signal_name, shutdown.set)

    async with worker:
        await shutdown.wait()
    logger.info("worker_stopped")


if __name__ == "__main__":
    asyncio.run(main())
