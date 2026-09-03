.PHONY: install lint test test-unit test-e2e eval run seed-kb ui down \
	web-install web-dev web-lint web-test web-test-e2e

install:
	uv sync --dev
	cd services/gateway && go mod download
	cd services/web && npm ci

lint:
	uv run ruff check services/agent services/mcp-tools tests scripts
	uv run ruff format --check services/agent services/mcp-tools tests scripts
	cd services/gateway && test -z "$$(gofmt -l .)" && go vet ./...
	cd services/web && npm run lint && npm run typecheck

test: test-unit

test-unit:
	uv run pytest -m "not e2e" --cov --cov-report=term-missing -v
	cd services/gateway && go test -race ./...
	cd services/web && npm run test

# The whole stack, end to end. The worker runs the fixture model, so this is
# deterministic and costs nothing.
#
# `down -v` first because the Playwright smoke asserts the designed empty state
# ("Nothing here yet. Build one."), and it runs before the API suite for the same
# reason. Both then leave knowledge bases behind, which is why the order is fixed.
test-e2e:
	docker compose down -v
	docker compose -f compose.yaml -f compose.e2e.yaml up --build -d --wait
	cd services/web && npm run test:e2e
	RUN_E2E=1 uv run --env-file .env pytest -m e2e tests/e2e

# The fixture's traps (A3–A6) against a real model. These cost money and need a
# key: they are claims about a model's judgement, and the fixture model cannot
# check them. Run before and after changing app/graph/prompts.py.
eval:
	RUN_MODEL_EVAL=1 uv run --env-file .env pytest -m eval -v

run:
	docker compose up --build

# The reference knowledge base, straight to `ready`, without waiting on a model. Opt-in:
# an empty studio is a designed screen.
seed-kb:
	cd services/gateway && DATABASE_URL=$${DATABASE_URL:-postgres://kb:kb@localhost:5432/kb?sslmode=disable} \
		go run ./cmd/seed

# Temporal Web UI. Worth opening during an ingestion: one activity per source
# document and one per section, each with its own retries.
ui:
	open http://localhost:8233

down:
	docker compose down -v

# ── services/web ─────────────────────────────────────────────────────────────
# The web app is a BFF now: it turns uploads into text and proxies everything
# else to the Go API, so `web-dev` needs the gateway running (`make run`, or
# `docker compose up postgres temporal gateway worker`).

web-install:
	cd services/web && npm ci

web-dev:
	cd services/web && npm run dev

web-lint:
	cd services/web && npm run lint && npm run typecheck

web-test:
	cd services/web && npm run test

# Journey 1 in a real browser against the compose stack. Needs the Playwright
# browser once: cd services/web && npx playwright install chromium
web-test-e2e:
	cd services/web && npm run test:e2e
