FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app
RUN pip install --no-cache-dir uv==0.11.2
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY services/agent/app ./app
# MODEL_PROVIDER=fake replays the reference ingestion from here, which is what
# makes the whole stack demoable and testable without an API key.
COPY docs/productDocs/fixtures ./fixtures
ENV FIXTURE_DIR=/app/fixtures

RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

# No EXPOSE: the worker polls a Temporal task queue and serves no HTTP.
CMD ["python", "-m", "app.worker"]
