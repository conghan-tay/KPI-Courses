.PHONY: install lint test test-unit test-e2e run seed ui down \
	web-install web-dev web-lint web-test web-test-e2e web-seed

install:
	uv sync --dev
	cd services/gateway && go mod download

lint:
	uv run ruff check services/agent services/mcp-tools tests scripts
	uv run ruff format --check services/agent services/mcp-tools tests scripts
	cd services/gateway && test -z "$$(gofmt -l .)" && go vet ./...

test: test-unit

test-unit:
	uv run pytest -m "not e2e" --cov --cov-report=term-missing -v
	cd services/gateway && go test -v ./...

# Runs the real public API against the container stack. The chat model is faked, but
# retrieval uses real embeddings, so OPENAI_API_KEY must be set in .env.
test-e2e:
	docker compose -f compose.yaml -f compose.e2e.yaml up --build -d --wait
	RUN_E2E=1 uv run --env-file .env pytest -m e2e tests/e2e

run:
	docker compose up --build

seed:
	uv run python scripts/seed_knowledge.py

# Temporal Web UI: inspect run history, the approval pause, and per-node activities.
ui:
	open http://localhost:8233

down:
	docker compose down -v

# ── services/web — the Journey 1 frontend ────────────────────────────────────
# It runs standalone: no Temporal, no Chroma, no gateway. Ingestion defaults to
# mock mode, which replays docs/productDocs/fixtures and needs no API key.

web-install:
	cd services/web && npm ci

web-dev:
	cd services/web && npm run dev

web-lint:
	cd services/web && npm run lint && npm run typecheck

web-test:
	cd services/web && npm run test

# Builds the app and drives Journey 1 in a real browser. Needs the Playwright
# browser once: cd services/web && npx playwright install chromium
web-test-e2e:
	cd services/web && npm run test:e2e

# Puts the reference course in the studio. Opt-in: an empty studio is a
# designed screen.
web-seed:
	cd services/web && npm run seed
