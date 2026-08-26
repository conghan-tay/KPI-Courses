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

## Running it

```bash
npm ci
npm run dev            # http://localhost:3000/studio
npm run seed           # optional: puts the reference course in the studio
```

The studio starts empty on purpose — *"No courses yet. Make one."* is a designed
screen. `npm run seed` is there when you'd rather skip ahead.

To walk the real path, drop
[`docs/productDocs/fixtures/source.md`](../../docs/productDocs/fixtures/source.md)
on `/studio/new`. Its frontmatter fills in the title, tagline and price for you.

## Ingestion has two modes

| `INGEST_MODE` | What happens |
|---|---|
| `mock` (default) | Replays `docs/productDocs/fixtures/expected.json` with a staged status stream. No API key, deterministic. This is what CI runs. |
| `live` | The real single-LLM call from the POC spec, using the same `MODEL_PROVIDER` / `MODEL_NAME` convention as the Python worker in this repo. |

```bash
INGEST_MODE=live MODEL_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run dev
```

Copy `.env.example` to `.env.local` for anything you want to keep.

## The three failure states are built, not swallowed

```bash
# A PDF with no text layer → "This looks like a scan. Paste the text instead."
# Drop any scanned PDF on /studio/new.

# Ingestion dies mid-run → the draft survives, with the retry on it.
INGEST_FORCE_ERROR=1 npm run dev

# Fewer than three stances → the review screen defaults to Syllabus and
# reframes around where students get stuck. Delete stances until it flips.
```

## Where the data lives

There is no database. `lib/store.ts` is a JSON file at `.data/courses.json`
behind a `CourseStore` interface, which is enough for a draft that has to
survive three screens.

Two files are the entire data seam:

- **`lib/queries.ts`** — server-side reads. Server Components call the store
  directly; a server fetching its own HTTP endpoint buys nothing.
- **`lib/api-client.ts`** — everything the browser does, including the
  Server-Sent Events stream that ingestion runs on.

Pointing this at the Go gateway once it serves `/api/courses/*` means changing
those two, and nothing in `app/` or `components/`.

## The rule that is engineering, not styling

`GET /api/courses/:id?audience=public` runs `toPublicCourse` in
`lib/serialize.ts`, which is an **allowlist**. A stranger gets the `claim` of a
position and never the `because`, the `pushback`, the source quote, the lesson
bodies or the voice card — because those are never sent, not because they are
blurred in CSS. The review screen's preview panel re-fetches through that same
projection, so the panel proves the rule rather than imitating it.

`lib/serialize.test.ts` and the second e2e test are the guard on it.

## Tests

```bash
npm run lint && npm run typecheck
npm run test        # vitest, the pure layer
npm run test:e2e    # playwright, Journey 1 in a browser (mock mode)
```

The unit tests include assertion **A2** from
[`fixtures/README.md`](../../docs/productDocs/fixtures/README.md): every
`positions[].quote` in the fixture must appear verbatim in `source.md`. The
same check runs in the product — a stance whose quote isn't in your material
gets a hatch-gutter warning on its card before you can publish it.

The first e2e run needs the browser once:

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
| `Soften` | Needs a model, so it only acts in `live` mode; in `mock` mode it says so and you edit the claim yourself. |
| Publish link | Points at `/c/:slug`, which is Journey 2. The dialog says so rather than pretending. |
