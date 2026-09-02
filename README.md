# The Reverse Interview — Journey 1

A recruiter has to get approved, spend an hour with a chatbot that knows the candidate,
pay for that hour, and pass a four-question test before they are allowed to book twenty
minutes of the candidate's actual time. The candidate stops repeating themselves; the
recruiter has to demonstrate they did the reading.

**This repository builds Journey 1 only: the candidate's authoring journey.** Documents
in — a CV, architecture write-ups, notes on why you left — and a published knowledge base
out, along with the three artifacts the recruiter side runs on:

| Artifact | What it is |
|---|---|
| **Knowledge base** | 8–16 addressable sections. What the agent will answer from. |
| **Chips** | Eight questions a recruiter would type first. The candidate picks three for their front page. |
| **Quiz** | Twelve multiple-choice questions, three per category. The gate before a booking. |
| **Pre-roll** | One headline and four bullets: what's loaded, before the timer starts. |

The recruiter side — LinkedIn signup, the email approve/reject loop, the hour, its cost
meter, payments, the gate itself, booking — is specified in
[`docs/productDocs/POC_UserJourney.md`](docs/productDocs/POC_UserJourney.md) and is not
built.

---

## Architecture

```
browser
   │  same-origin, no API key
   ▼
services/web        Next.js. A BFF: turns uploads into text, proxies everything else.
   │  X-API-Key + X-Candidate-Id
   ▼
services/gateway    Go. Owns the schema, the publish rules, the public projection,
   │                and the SSE stream. No model client lives here.
   ▼  gRPC
Temporal ─────────► services/agent   Python. LangGraph ingestion, one activity per step.
   │                                  No database: it returns a result and the gateway
   ▼                                  persists it.
Postgres
```

Three languages, one contract. `services/gateway/internal/api/types.go`,
`services/agent/app/core/kb_schemas.py` and `services/web/lib/types.ts` carry the same
field names, and **nothing enforces that at build time** — a renamed JSON tag surfaces as
a workflow task failure or a client-side parse error. `make test-e2e` is what catches it.

### The ingestion pipeline

Not one model call. Chips and quiz items cite sections by id, so the sections have to
exist first:

```
sanitize → segment → read_segment*  → plan_sections → write_section*
  → generate_chips → generate_quiz → verify_refs ⇄ repair_refs
  → write_pre_roll → assemble
```

`*` loops. Each node is a Temporal activity with its own timeout and retry, so a flaky
call on section nine is retried in isolation rather than restarting the run, and one
enormous generation cannot hit a max-token wall. It is also what makes
`WRITING SECTION 4 OF 14` an honest status line rather than a guess.

Two rules are enforced twice — once in the prompt, once in code:

- **No invention, and no upgrading.** An unpaid advisory seat stays an unpaid advisory
  seat; a stated limit stays stated. This is the product: an agent that flatters the
  candidate misrepresents them to a recruiter, in their name.
- **Every chip and quiz item names a section, and the reference must resolve.** A plain
  string comparison, run in the graph (`verify_refs`), in the gateway
  (`UnresolvedChips`) and on the review screen (`auditRefs`). One that still resolves to
  nothing after a bounded repair is *cleared*, so the card shows as unsourced rather than
  shipping a citation that leads nowhere.

---

## What this demonstrates

- **Durability that survives a closed tab.** The draft row is written before the pipeline
  starts, and a background watcher persists the result on a context that outlives the
  HTTP request. Close the tab thirty seconds in and the knowledge base still lands.
- **Re-attachment across a restart.** On boot the gateway reconciles every run still in
  flight and re-attaches a watcher.
- **A retry that needs no re-upload.** The source text was stored on the way in.
- **A withholding rule that is engineering, not styling.** The public projection is an
  allowlist in Go. It omits the entire quiz — that is a security control, because the
  quiz gates twenty minutes of the candidate's real time and a leaked `correct_index`
  makes the gate a formality.
- **Deterministic, free CI.** `MODEL_PROVIDER=fake` replays
  `docs/productDocs/fixtures/expected.json` step by step, so the whole stack runs end to
  end with no API key.

---

## Quick start

```bash
cp .env.example .env          # the defaults run everything on the fixture model
make run                      # docker compose up --build
open http://localhost:3000    # redirects to /studio
```

Then drop the seven documents in `docs/productDocs/fixtures/` on `/studio/new`, or skip
the wait:

```bash
make seed-kb                  # the reference knowledge base, straight to `ready`
```

To run a real ingestion, set `MODEL_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` in
`.env`, then `make run` again.

**If you are upgrading an existing checkout, run `make down` once.** `migrate.go` records
applied migrations, so the rewritten `0001_init.sql` will not re-run against a volume
that has already seen the old schema.

---

## Repository map

```
docs/productDocs/
  POC_UserJourney.md          the three journeys; Journey 1 in build detail
  DESIGN.md                   the RISO POSTER design language
  TheReverseInterview/        the original idea, and the authored prompts for
                              chips, the quiz and the pre-roll
  fixtures/                   the reference case: 7 documents + expected.json,
                              and the B1–B8 assertions they exist to support

services/web/                 Next.js. Screens, the dropzone, PDF extraction.
  lib/types.ts                zod schemas — one third of the contract
  lib/refs.ts                 reference resolution (assertion B2), client side
  app/api/kb/*                thin proxies; `ingest` is the one that does work

services/gateway/             Go.
  internal/api/types.go       the wire contract — one third of the contract
  internal/kb/                the rules: drafts, publish blockers, the projection
  internal/store/             pgx, and the migration applied at boot

services/agent/               Python.
  app/core/kb_schemas.py      Pydantic models — one third of the contract
  app/graph/prompts.py        the prompts, ported from TheReverseInterview/
  app/graph/ingest.py         the pipeline
  app/graph/refs.py           reference resolution (assertion B2), worker side
  app/temporal/kb_workflow.py the durable workflow

tests/e2e/                    the whole stack, over the wire
```

---

## API

The Go gateway, behind `X-API-Key`:

```
POST  /v1/knowledge-bases/ingest                    text + meta → draft + SSE
GET   /v1/knowledge-bases                           the candidate's list
GET   /v1/knowledge-bases/{id}                      the owner's copy
GET   /v1/knowledge-bases/{id}?audience=public      the projection a stranger gets
PATCH /v1/knowledge-bases/{id}                      partial edits
POST  /v1/knowledge-bases/{id}/publish
POST  /v1/knowledge-bases/{id}/reingest             retry from stored source text
POST  /v1/knowledge-bases/{id}/chips/{i}/rephrase   ?register=skeptical|narrative|blunt
```

The web app mirrors these under `/api/kb/*` so the browser stays same-origin and never
holds the API key.

### Errors

One envelope, everywhere: `{ "error": { "code", "message", "fields?", "blockers?" } }`.
Screens branch on `code` — `no_text_layer` switches to the paste tab, `not_publishable`
lists every blocker at once, `invalid_meta` puts a message next to a field. The proxy
forwards it verbatim rather than re-deriving it, so there is no second place the contract
can drift.

### Identity, and one thing to be honest about

`X-Candidate-Id` is a header the gateway trusts because the API key gates the hop. That
is exactly as strong as POC_UserJourney.md §0's dev-mode role switcher — which is to say,
**anything holding the API key can act as any seeded user.** Replacing it with a real
token is the first thing to do before this meets a real recruiter.

---

## Ingestion, and how it can fail

Every failure state is a designed screen, not a toast:

| Failure | What happens |
|---|---|
| PDF with no text layer | *"This looks like a scan. Paste the text instead."* — the form switches to the paste tab |
| Fewer than 8 chips, or fewer than 12 quiz items | Warns. Never blocks: a sparse corpus still makes a knowledge base worth publishing |
| A quiz category with nothing in it | **Blocks.** The gate samples one item per category, so this is a gate that cannot run |
| Not exactly three chips selected | **Blocks.** A front page with two questions on it is a broken screen |
| Pipeline dies mid-run | The draft survives with its source text; `[RETRY]` re-runs it with no re-upload |
| Tab closed mid-run | The watcher persists the result anyway |

Worth trying by hand:

```
# Closed tab: start an ingest, close the tab, reopen /studio a minute later.
# Restart:    start an ingest, then `docker compose restart gateway`.
# Failure:    `docker compose stop worker`, ingest, then start it and retry.
# Scan:       drop an image-only PDF and read the message.
```

---

## Tests and quality checks

```bash
make lint          # ruff · gofmt/vet · eslint + tsc
make test-unit     # pytest · go test -race · vitest
make test-e2e      # the whole stack: browser smoke first, then the API suite
make eval          # the judgement assertions, against a real model (costs money)
```

`make test-e2e` starts with `docker compose down -v`, because the Playwright smoke
asserts the designed empty state and runs before the API suite for the same reason.

**What the unit tests can and cannot prove.** The fixture model is an oracle: it answers
each step with `expected.json` rather than reasoning. So the unit suites prove the
*pipeline* — documents split and read in order, ordinals assigned, malformed quiz items
dropped, an unresolvable reference repaired and then cleared, the caps holding.

They do not prove the extraction. Assertions B3 (no invention), B5 (limits surfaced), B6
(chip register mix) and B7 (quiz distractor quality) are claims about a *model's
judgement*, and only `make eval` against a live provider can check them. Pretending
otherwise would be a test suite that proves nothing while looking thorough. See
[`docs/productDocs/fixtures/README.md`](docs/productDocs/fixtures/README.md).

---

## Production deployment

`deploy/k8s/app.yaml` is a starting point, not a finished manifest. Before it meets real
traffic: replace `X-Candidate-Id` with a real token, put object storage behind the
uploads, and give Temporal a real namespace with retention configured. `ENVIRONMENT=production`
already refuses to start with `MODEL_PROVIDER=fake`.

See [`docs/deployment.md`](docs/deployment.md) and [`docs/railway.md`](docs/railway.md).

---

## What is parked

`services/mcp-tools` and the Chroma vector store behind `POST /v1/vectors` are retained
from the reference application this repository grew out of. Nothing in Journey 1 calls
them. They stay because Journey 2's hour-long chat will need tools and, at a large enough
knowledge base, retrieval — but at Journey 1's size the whole thing goes in the prompt,
and adding RAG now would be complexity with no reader.

---

## Why the services are split

The gateway is Go because it is the thing that must not fall over: it owns the schema,
the ownership checks and the projection that decides what a stranger sees. The agent is
Python because that is where LangGraph lives. Temporal sits between them because
ingestion is a two-minute operation that has to survive a deploy, and every alternative —
a job table, a queue, a retry loop — is a worse version of what Temporal already does.

The web app is a BFF rather than a client because the gateway's API key must never reach
a browser, and because PDF extraction belongs where pdf.js is.
