# services/web — Journey 1

The Specialist's path from a folder of messy notes to a published course, from
[`docs/productDocs/POC_UserJourney.md`](../../docs/productDocs/POC_UserJourney.md),
built in the RISO POSTER language defined by
[`DESIGN.md`](../../docs/productDocs/DESIGN.md).

Journeys 2 (evaluate → buy) and 3 (learn through chat) are **not** in this app
yet. Every component they need — the locked position card, the syllabus rail,
the progress meter, the asymmetric thread, the citation chip, the composer — is
built and in use here.

```
/                     → redirects to /studio (the catalog is Journey 2)
/studio               course list
/studio/new           drop files, title, tagline, price → [Build my course]
/studio/:id           review: Positions · Syllabus · Voice, and publish
/studio/:id/preview   what a student sees, rendered from the draft, static
```

## This app is a BFF, not the API

It renders the screens, turns uploads into text, and proxies everything else to
the Go API. That means **it does not run on its own** — `npm run dev` in front of
nothing gets you a studio that cannot list a course.

```bash
# the API, Postgres, Temporal and a worker on the fixture model
docker compose up postgres temporal gateway worker

npm ci
npm run dev            # http://localhost:3000/studio
```

Or bring up everything, including a containerised copy of this app:

```bash
make run               # http://localhost:3000/studio
make seed-course       # optional: the reference course, already ingested
```

The studio starts empty on purpose — *"No courses yet. Make one."* is a designed
screen. Seeding is there when you'd rather skip ahead.

To walk the real path, drop
[`docs/productDocs/fixtures/source.md`](../../docs/productDocs/fixtures/source.md)
on `/studio/new`. Its frontmatter fills in the title, tagline and price for you.

## The data seam is three files

- **`lib/gateway.ts`** — the only place this app talks to Go. It reads the
  signed-in user from the cookie and adds `X-API-Key` and `X-Specialist-Id`
  server-side, so the browser never holds a credential. `API_BASE_URL` is
  deliberately not `NEXT_PUBLIC_`.
- **`lib/queries.ts`** — Server Component reads, straight to the Go API. A server
  fetching its own route handler to reach a third server is a round trip that
  buys nothing.
- **`lib/api-client.ts`** — everything the browser does, same-origin, including
  the Server-Sent Events stream that ingestion runs on. `EventSource` cannot
  POST, so the stream is read with `fetch` + `getReader()`.

Everything under `app/api/courses/` is a thin proxy in front of `lib/gateway.ts`.
Nothing in `app/` or `components/` knows the Go API exists.

## Except one route, which earns it

`POST /api/courses/ingest` is the exception, and the reason is upload handling.
`lib/extract.ts` turns `.md`, `.txt` and PDFs-with-a-text-layer into one corpus
before anything crosses the wire: pdf.js is materially better at it than anything
available in Go, the designed *"This looks like a scan"* state is already built
around it, and raw PDF bytes never go near Temporal's payload limit. The Go
endpoint takes text.

`joinCorpus` writes a `# SOURCE FILE: name` header before each upload. That is
not decoration — the ingestion graph splits the corpus back apart on it, and
reading a manuscript separately from a podcast transcript is the whole basis of
the attribution rule.

## The failure states are built, not swallowed

```bash
# A PDF with no text layer → "This looks like a scan. Paste the text instead."
# Drop any scanned PDF on /studio/new. Never reaches the Go API.

# Ingestion dies mid-run → the draft survives, with the retry on it.
docker compose stop worker      # then ingest, then start it again and retry

# The API is down → "The course service isn't responding."
docker compose stop gateway

# Fewer than three stances → the review screen defaults to Syllabus and
# reframes around where students get stuck. Delete stances until it flips.
```

## The rule that is engineering, not styling

`GET /api/courses/:id?audience=public` is forwarded to the Go API, which applies
an **allowlist**. A stranger gets the `claim` of a position and never the
`because`, the `pushback`, the source quote, the lesson bodies or the voice card
— because those are never sent, not because they are blurred in CSS.

The projection lives in Go on purpose. The review screen's preview panel
re-fetches through that same endpoint, so the panel *proves* the rule rather than
imitating it, and there is exactly one implementation to keep honest. Its guards
are `TestPublicProjectionWithholdsTheArgument` in
`services/gateway/internal/courses/courses_test.go` and the second Playwright
test here.

## Tests

```bash
npm run lint && npm run typecheck
npm run test        # vitest, the pure layer and the proxy seam
npm run test:e2e    # playwright, Journey 1 against the running stack
```

The unit tests include assertion **A2** from
[`fixtures/README.md`](../../docs/productDocs/fixtures/README.md): every
`positions[].quote` in the fixture must appear verbatim in `source.md`. The same
check runs in the product twice — in the ingestion graph, which clears a quote it
cannot anchor, and here, where an unanchored stance gets a hatch-gutter warning
on its card before you can publish it.

`npm run test:e2e` needs the stack up (`make test-e2e` does that for you) and the
browser once:

```bash
npx playwright install chromium
```

## Divergences from the POC spec, and why

| Change | Reason |
|---|---|
| `positions[].quote` | The ingestion prompt asks for a quote anchor and the fixture carries one; the POC schema had nowhere to put it. |
| `voice_card.refuses_to` | In the fixture, absent from the POC sketch. |
| `courses.ingest_status` | "Ingestion timeout → keep the draft, offer retry" needs somewhere to record that. The draft row is written *before* the model call. |
| Specialist name and bio | Taken from the seeded dev user, not asked for at upload. |
| `Soften` | Runs as a Temporal workflow behind the API, so it works in every mode — with the fixture model it returns a deterministic hedge rather than a dead button. |
| Publish link | Points at `/c/:slug`, which is Journey 2. The dialog says so rather than pretending. |
