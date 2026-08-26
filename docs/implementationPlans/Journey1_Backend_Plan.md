# Journey 1 Backend — Go API + LangGraph/Temporal ingestion

## Context

[`Journey1_Frontend_Plan.md`](Journey1_Frontend_Plan.md) built the Specialist's screens, but
the app was talking to itself: `services/web` owned a JSON-file store, the ingestion prompt,
the publish rules and the public projection, and ingestion was one `generateObject` call in
Node. The rest of the repository was a support-ticket reference app — a Go gateway driving a
LangGraph agent on a Temporal worker — kept as a shape to copy, not as part of the product.

This PR builds the real backend: a Go API that owns courses in Postgres, and a multi-node
LangGraph ingestion pipeline running as Temporal activities. The web app becomes a BFF in
front of it. No screen, component or design token changed.

Journeys 2 and 3 stay out of scope, but the `users`/`courses`/`lessons` tables, the SSE
plumbing and the fixture-model convention are what they extend.

### Decisions taken

| Decision | Choice |
|---|---|
| Persistence | **Postgres**, per POC §1. The gateway owns the schema and applies migrations at boot. |
| Graph shape | **Multi-node pipeline**, not one call — it is what makes the fixture's traps addressable and what earns LangGraph + Temporal. |
| API boundary | **Next route handlers proxy to Go.** Extraction stays in `lib/extract.ts` (unpdf); the Go ingest endpoint takes JSON text. No CORS, no key in the browser, no PDF bytes near Temporal's payload limit. |
| Old code | Ticket **domain** code deleted. The infra containers — chroma, mcp-tools, redis — and `/v1/knowledge` stay, parked for Journey 3. |

---

## What was built

### Go API (`services/gateway`)

Module renamed to `github.com/example/kpi-courses/services/gateway`. `internal/tickets` and
the ticket API types are gone; the auth, rate-limit, request-id and error-mapping middleware
in `handler.go` and `ratelimit.go` are unchanged.

- **`internal/api/types.go`** — the wire contract. Its JSON tags are a three-way agreement
  with `app/core/course_schemas.py` and `services/web/lib/types.ts`, enforced by nothing at
  build time and by `make test-e2e` at runtime.
- **`internal/store/`** — `Repository` over pgx, plus `migrations/0001_init.sql` embedded
  with `embed.FS` and applied at boot under a Postgres advisory lock. `users`, `courses`
  (positions and voice card as JSONB, per POC §1) and `lessons` (a table, because Journey 3
  addresses them by ordinal). A lesson patch rewrites the whole list in one transaction,
  which sidesteps `UNIQUE (course_id, ord)` collisions mid-reorder.
- **`internal/courses/courses.go`** — the pure layer, ported from the TypeScript it replaces
  so behaviour is identical: draft creation, publish blockers, the public projection,
  renumbering, slugification.
- **`internal/courses/ingest.go`** — the part that matters. The draft is written *before* the
  workflow starts. Then two independent things happen: a **completion watcher** on
  `context.Background()` persists the result regardless of what the HTTP request does, and
  the request **streams** status. The stream reads lines from the workflow query but terminal
  state from the database, so "ready" can never arrive before the lessons it promises. On
  boot, `Reconcile` re-attaches a watcher to every run still in flight.
- **`cmd/seed`** — the fixture straight to `ready`, for when you would rather not wait.

### Ingestion pipeline (`services/agent`)

The support graph, its models, tools and knowledge repository are gone. `safety.py`,
`settings.py`, `logging.py` and `temporal/client.py` are reused — the pydantic data converter
in particular is what lets Go and Python agree on a payload.

Ten nodes: `sanitize`, `segment`, `read_segment` (loops), `resolve_positions`,
`verify_quotes`, `repair_quotes`, `plan_lessons`, `write_lesson` (loops), `read_voice`,
`assemble`. The two loops are self-edges rather than `Send` fan-out — plain LangGraph, no
assumption about how much of the streaming API the Temporal plugin forwards — and each
iteration is its own activity with its own retry.

Two things are worth calling out because they are not obvious from the node list:

- **Attribution is enforced twice.** The prompt asks the reader to mark who spoke;
  `resolve_positions` then *drops* `by_author=false` candidates in code. A model that forgets
  the rule still cannot produce a tutor arguing a guest's position in the Specialist's voice.
- **Status lines escape through a signal.** Nodes run as activities, in a different context
  from the workflow the gateway queries, so a node cannot write to workflow state. The
  activity-side reporter signals the workflow that scheduled it, and the workflow accumulates
  what its `get_progress` query returns. See `graph/progress.py` for why this rather than
  graph streaming.

`MODEL_PROVIDER=fake` replays `docs/productDocs/fixtures/expected.json` step by step, which
is what makes CI, the compose stack and the browser smoke deterministic and free.

### `services/web` as a BFF

`lib/gateway.ts` is the only place this app talks to Go: it resolves the cookie user, adds
`X-API-Key` and `X-Specialist-Id`, and forwards. Every route handler under
`app/api/courses/` is a thin proxy in front of it — except `ingest`, which keeps its
multipart parsing and `lib/extract.ts` call so the designed *"This looks like a scan"* state
survives verbatim, then POSTs text and pipes the SSE body straight back.

Deleted: `lib/store.ts`, `lib/courses.ts`, `lib/serialize.ts`, `lib/ingest/{index,prompt,stream}.ts`,
`scripts/seed.ts`, and the `ai` / `@ai-sdk/*` dependencies.

---

## Things that turned out differently

- **`Send` fan-out was never needed.** The self-loop shape works, and one activity per source
  file and per lesson is what makes the status stream honest. Parallelising remains a
  follow-up, not a prerequisite.
- **The browser cannot assert the status stream.** Replaying the fixture takes about a
  second, so the ingestion panel is gone before Playwright can see it. An assertion that
  passes on a slow machine and fails on a fast one is worse than none, so the status frames
  are asserted in `tests/e2e/test_journey1_e2e.py`, which reads the SSE response directly.
- **The fixture's traps split into two kinds.** A2 (quote anchoring) is a string match and
  runs in CI *and in the product*. A1/A7 became code-enforced caps. But A3–A6 as *judgement*
  — did the model notice the walkback, the restatement, the craft? — cannot be checked by a
  fixture that replays the right answer. Those are `make eval`, against a live provider,
  skipped by default. Pretending otherwise would have been a test suite that proves nothing
  while looking thorough.
- **Postgres 18 moved its mount point.** `/var/lib/postgresql`, not `/var/lib/postgresql/data`.
- **Next's standalone server binds `HOSTNAME`**, which Docker sets to the container id;
  resolving it fails intermittently and crash-loops the container. `ENV HOSTNAME=0.0.0.0`.

---

## Verified

```bash
make lint && make test-unit      # ruff · gofmt/vet/go test -race · eslint/tsc/vitest
make test-e2e                    # the whole stack: browser first, then API
```

By hand against the running stack, since these are the claims the README makes:

- **Closed tab** — hung up immediately after the `draft` frame; the course still reached
  `ready` with 7 lessons and 7 positions.
- **Gateway restart mid-run** — the new process logged
  `re-attaching to an in-flight ingestion` and finished the course.
- **Worker down, then back** — the draft survived as `running`, the queued workflow was
  picked up on recovery, and the course completed.
- **Unique slugs** — seeding after a published `hold-your-number` produced
  `hold-your-number-2`.

Not verified: a live ingestion against a real provider. Everything above ran on
`MODEL_PROVIDER=fake`. The `make eval` suite exists for that and needs a key.

---

## Explicitly not in this PR

Journey 2 (catalog, `/c/:slug`, sample chat, checkout) · Journey 3 (the tutor loop, the four
tools, citation chips) · real authentication, which the trusted `X-Specialist-Id` header
stands in for · payments · object storage for original uploads.
