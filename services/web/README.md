# services/web — Journey 1

The candidate's path from a folder of documents to a published knowledge base, from
[`docs/productDocs/POC_UserJourney.md`](../../docs/productDocs/POC_UserJourney.md),
built in the WARM DOCUMENT language defined by
[`NEW_DESIGN.md`](../../docs/productDocs/NEW_DESIGN.md).

Journeys 2 (approved, paying, one hour) and 3 (the gate, then a booking) are **not** in
this app. The components they share with Journey 1 — the pre-roll card, the public chip,
the section index, the portrait — are built and in use here.

```
/                     → redirects to /studio (/k/:slug is Journey 2)
/studio               the candidate's knowledge bases
/studio/new           drop documents, name, one line → [Build my knowledge base]
/studio/:id           review: Questions · Knowledge base · Quiz · Pre-roll, and publish
/studio/:id/preview   what a recruiter sees, rendered from the draft, static
```

## This app is a BFF, not the API

It renders the screens, turns uploads into text, and proxies everything else to the Go
API. That means **it does not run on its own** — `npm run dev` in front of nothing gets
you a studio that cannot list anything.

```bash
# the API, Postgres, Temporal and a worker on the fixture model
docker compose up postgres temporal gateway worker

npm ci
npm run dev            # http://localhost:3000/studio
```

Or bring up everything, including a containerised copy of this app:

```bash
make run               # http://localhost:3000/studio
make seed-kb           # optional: the reference knowledge base, already ingested
```

The studio starts empty on purpose — *"Nothing here yet. Build one."* is a designed
screen. Seeding is there when you'd rather skip ahead.

To walk the real path, drop the seven documents in
[`docs/productDocs/fixtures/`](../../docs/productDocs/fixtures/) on `/studio/new`.
`resume.md`'s frontmatter fills in the name and the one-liner for you.

## The data seam is three files

- **`lib/gateway.ts`** — the only place this app talks to Go. It reads the signed-in user
  from the cookie and adds `X-API-Key` and `X-Candidate-Id` server-side, so the browser
  never holds a credential. `API_BASE_URL` is deliberately not `NEXT_PUBLIC_`.
- **`lib/queries.ts`** — Server Component reads, straight to the Go API. A server
  fetching its own route handler to reach a third server is a round trip that buys
  nothing.
- **`lib/api-client.ts`** — everything the browser does, same-origin, including the
  Server-Sent Events stream that ingestion runs on. `EventSource` cannot POST, so the
  stream is read with `fetch` + `getReader()`.

Everything under `app/api/kb/` is a thin proxy in front of `lib/gateway.ts`. Nothing in
`app/` or `components/` knows the Go API exists.

## Except one route, which earns it

`POST /api/kb/ingest` is the exception, and the reason is upload handling.
`lib/extract.ts` turns `.md`, `.txt` and PDFs-with-a-text-layer into one corpus before
anything crosses the wire: pdf.js is materially better at it than anything available in
Go, the designed *"This looks like a scan"* state is already built around it, and raw PDF
bytes never go near Temporal's payload limit. The Go endpoint takes text.

`joinCorpus` writes a `# SOURCE FILE: name` header before each upload. That is not
decoration — the ingestion graph splits the corpus back apart on it, and reading a CV
separately from an architecture write-up is what lets each document be classified at all.

## The failure states are built, not swallowed

```bash
# A PDF with no text layer → "This looks like a scan. Paste the text instead."
# Drop any scanned PDF on /studio/new. Never reaches the Go API.

# Ingestion dies mid-run → the draft survives, with the retry on it.
docker compose stop worker      # then ingest, then start it again and retry

# The API is down → "The knowledge-base service isn't responding."
docker compose stop gateway

# A question pointing at a section that isn't there → the source field turns
# danger with a message under it. Delete a section on the Knowledge base tab
# and watch three questions flag themselves.

# A quiz category with nothing in it → the Quiz tab says the gate can't run,
# and publish refuses. Delete every `limits` question to see it.
```

## The rule that is engineering, not styling

`GET /api/kb/:id?audience=public` is forwarded to the Go API, which applies an
**allowlist**. A stranger gets the pre-roll, the three chosen questions' text, and
section titles and summaries. They never get the quiz, `why_it_lands`, a section body or
the source text — because those are never sent, not because they are hidden in CSS.

The quiz is the one that matters most, and it is a security control rather than a
conversion mechanic: it gates booking twenty minutes of the candidate's real time, so a
`correct_index` in a devtools panel does not leak a teaser, it hands over the answer key.

The projection lives in Go on purpose. The review screen's preview panel re-fetches
through that same endpoint, so the panel *proves* the rule rather than imitating it, and
there is exactly one implementation to keep honest. Its guards are
`TestPublicProjectionWithholdsTheQuizAndTheBodies` in
`services/gateway/internal/kb/kb_test.go` and the second Playwright test here.

## Tests

```bash
npm run lint && npm run typecheck
npm run test        # vitest, the pure layer and the proxy seam
npm run test:e2e    # playwright, Journey 1 against the running stack
```

The unit tests include assertion **B2** from
[`fixtures/README.md`](../../docs/productDocs/fixtures/README.md): every
`chips[].kb_section` and `quiz[].source_section` must resolve to a section that exists.
The same check runs in the product twice — in the ingestion graph, which clears a
reference it cannot resolve, and here in `lib/refs.ts`, which is what puts a warning on a
card when the *candidate* deletes the section out from under it.

`npm run test:e2e` needs the stack up (`make test-e2e` does that for you) and the browser
once:

```bash
npx playwright install chromium
```

## Divergences from the supplied examples, and why

| Change | Reason |
|---|---|
| `chips[].register` | `chips_example_prompt.txt` asks for a mix of skeptical, narrative and blunt. Storing the label is what makes the mix checkable, and what makes `Rephrase` "say this blunter" rather than a coin flip. |
| `chips[].selected` | `chips.json`: *"Generate eight, candidate picks three."* The selection had nowhere else to live. |
| `quiz[].category` | `quiz_example_prompt.txt` defines four categories and the gate samples four questions. One per category is the obvious sample, and it is impossible without the label. |
| No `price_cents` | Pricing is fixed at the platform level ($3 + model cost per hour), so it is copy on the pre-roll rather than a field a candidate fills in. |
| `ingest_status` | "Ingestion timeout → keep the draft, offer retry" needs somewhere to record that. The draft row is written *before* the pipeline runs. |
| Candidate name and bio | Taken from the seeded dev user, not asked for at upload. |
| `Rephrase` | Runs as a Temporal workflow behind the API, so it works in every mode — with the fixture model it returns a deterministic rewrite rather than a dead button. |
| Publish link | Points at `/k/:slug`, which is Journey 2. The dialog says so rather than pretending. |

Two conflicts between the supplied JSON and the prompts beside it are resolved in
[`fixtures/README.md`](../../docs/productDocs/fixtures/README.md) — the short version is
that the prompt wins.
