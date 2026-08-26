# Journey 1 Frontend — Specialist: raw material → published course

> **Historical record.** This plan shipped as written. The seam it deliberately left open —
> "the API it talks to is served by the web app's own route handlers … so the real Go backend
> can replace it later without touching a screen" — has since been closed by
> [`Journey1_Backend_Plan.md`](Journey1_Backend_Plan.md). `INGEST_MODE`, `lib/store.ts`,
> `lib/serialize.ts` and `lib/ingest/` no longer exist; ingestion runs as a LangGraph pipeline
> on a Temporal worker behind a Go API. No screen or component changed, which is the part
> this plan got right.

## Context

`docs/productDocs/POC_UserJourney.md` specifies a chat-native tutoring POC (Specialist publishes a
course → Seeker evaluates → Seeker learns). This repository currently implements none of it: it is a
support-ticket agent reference app (Go gateway → Temporal → LangGraph worker, `services/gateway`,
`services/agent`). There is no frontend and no `/api/courses/*` surface anywhere.

This PR builds **only Journey 1** — the Specialist path from dropped files to a published course —
as a Next.js app in the RISO POSTER language defined by `docs/productDocs/DESIGN.md`, verified
against `docs/productDocs/preview.html`. It is a frontend PR: the API it talks to is served by the
web app's own route handlers, behind a single typed client so the real Go backend can replace it
later without touching a screen.

Journeys 2 and 3 are deliberately out of scope, but every component this PR builds
(`PositionCard` locked variant, `SyllabusRail`, `ProgressMeter`, `Thread`) is one they reuse.

---

## Decisions (confirmed)

1. **Data source** — Next.js route handlers own `/api/courses/*`. `INGEST_MODE=mock` (default)
   replays `docs/productDocs/fixtures/expected.json` with a staged status stream; `INGEST_MODE=live`
   makes the real single-LLM ingestion call. Everything goes through `lib/api-client.ts`.
2. **Preview** — `/studio/:id/preview` is a *static* shell: real `SyllabusRail`, `ProgressMeter` and
   `SpecialistTurn` components rendering the draft's own lessons plus the scripted opening
   diagnostic. Composer visible, disabled. No chat backend.
3. **File input** — `.md`/`.txt` read directly, PDFs parsed server-side with `unpdf`, a PDF with no
   text layer hits the designed *"This looks like a scan. Paste the text instead."* state. A paste
   tab is always available.

---

## Gaps I found, and the assumption I'm building under

These are the places the specs disagree or are silent. Each is cheap to change — say so and I will.

| Gap | Decision |
|---|---|
| `positions[].quote` is in the fixture but not in the POC `positions_json` schema (`fixtures/README.md` flags this). | **Include it, optional.** Rendered as a `▸ SOURCE` expandable on each position card, and used by an in-app quote-anchor check (fixture assertion A2) that flags any position whose quote isn't verbatim in the source with the hatch warning treatment. It is the hallucination canary and it makes the review screen trustworthy. |
| `voice_card.refuses_to` is in the fixture, not in the POC sketch. | Included as an optional field, editable in the Voice tab. |
| Nothing in the data model survives a failed ingestion, but the spec requires "keep the draft, offer retry". | Add `courses.ingest_status: 'running' \| 'ready' \| 'failed'`. The draft row is written **before** the model call, so a timeout leaves a retryable draft. |
| Specialist name/bio have no form field (they're frontmatter in the fixture). | Taken from the seeded dev user behind the `SIGN IN AS` switcher, not asked for at upload. |
| `Soften` on a position card has no defined behaviour without a model. | In `live` mode it is one small LLM rewrite of the claim. In `mock` mode it opens the claim inline with guidance copy — deterministic, and the button is never dead. |
| DESIGN §5.3 gives `/studio/:id` an 8/4 "editor / live preview" split but doesn't say what the preview shows. | The 4-col panel renders **locked** position cards fetched from `GET /api/courses/:id?audience=public`. It shows the Specialist what a stranger sees, and it proves the withholding rule (§4.5) is server-side rather than a CSS blur. |
| `[Publish]` returns a "shareable link" to `/c/:slug`, which is Journey 2. | Publish shows a dialog with the copyable URL and states plainly that the course page ships with Journey 2. No half-built catalog page in this PR. |
| Thin-results threshold is described but not numbered. | `positions.length < 3` → review screen defaults to **Syllabus**, the heading reframes to `WHERE STUDENTS GET STUCK`, a hatch-gutter panel warns, and publish is still allowed. |
| TypeScript 7.0.2 is the current stable but is a new native compiler; Next 16 scaffolds TS 5.x. | Scaffold with `create-next-app` defaults, then attempt TS 7. If `next build` or typecheck breaks, pin the latest 5.x and note it in the PR. Everything else is pinned to today's latest stable. |

---

## Package set (verified latest stable, 2026-08-25)

`next@16.3.2` · `react`/`react-dom@19.2.8` · `tailwindcss@4.3.3` · `zod@4.4.3` ·
`shadcn@4.19.0` (CLI) · `@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0` · `lucide-react@1.34.0` ·
`react-markdown@10.1.0` · `unpdf@1.8.1` · `ai@7.0.79` + `@ai-sdk/openai` + `@ai-sdk/anthropic` ·
`vitest@4.1.11` · `@testing-library/react@16.3.2` · `@playwright/test@1.62.1`. npm, Node 22.

---

## Implementation

### Phase 0 — Scaffold `services/web`

`npx create-next-app@latest` (TypeScript, App Router, Tailwind, ESLint, no `src/`) into
`services/web`, matching the repo's `services/*` convention. Then `npx shadcn@latest init` and add
`button tabs dialog input textarea dropdown-menu separator tooltip avatar`.

Apply DESIGN §12's two global overrides immediately: every `rounded-md` → `rounded-none` (Button →
`rounded-full`), every `shadow-sm`/`shadow-md` → `shadow-lift`. Retheme the copied shadcn files in
place; do not wrap them.

`app/globals.css` carries the `@theme` block from DESIGN §12 verbatim, plus the four patterns from
§10 (`.pat-halftone .pat-hatch .pat-meander .hl`) and the `.stream-caret` keyframes.
`app/fonts.ts` is the Archivo/Newsreader/DM_Mono block from DESIGN §3 verbatim.

`docs/productDocs/preview.html` is the reference render — open it side by side and match it. Its
class names map 1:1 onto the type scale (`.dxl .dl .dm .ttl .bl .bd .bs .lb .mt`); mirror that scale
as Tailwind utilities or `@utility` rules rather than re-deriving sizes.

### Phase 1 — `AppFrame` (build first; every screen inherits the look)

`components/frame/AppFrame.tsx` · `Ticker.tsx` · `MeanderRail.tsx` · `RoleSwitcher.tsx`.

Pink surround → 3px black sheet (`max-width: 1440px`) → 28px meander rail → nav (three dots, links,
`SIGN IN AS` dropdown) → content (`max-width: 1200px`) → bottom ticker. Responsive per DESIGN §8:
32px surround at ≥1280, 16px at 768–1279, 0 and 2px border below 768.

`variant="scroll" | "fixed"` — `fixed` makes the sheet scroll internally so the frame stays put on
`/studio/:id` and `/studio/:id/preview` (§5.1).

`RoleSwitcher` writes a cookie from two seeded users in `lib/seed.ts` (Dana Mercado, specialist;
one seeker). Journey 1 only reads the specialist.

### Phase 2 — Types, store, and the API seam

- `lib/types.ts` — zod schemas: `Position` (claim, because, pushback, quote?), `VoiceCard`,
  `Lesson`, `Course`, `IngestRequest`, `IngestEvent`. **`expected.json` must parse against these** —
  that is a unit test.
- `lib/store.ts` — `CourseStore` interface (`list/get/create/update/publish`) over a JSON file at
  `services/web/.data/courses.json` (gitignored). Starts empty so the `"No courses yet. Make one."`
  state is real; `npm run seed` inserts the fixture draft.
- `lib/serialize.ts` — `serializeCourse(course, audience)`. `'public'` strips `because`, `pushback`,
  `quote` and `body_md`. This is the §4.5 withholding rule and it lives on the server.
- `lib/api-client.ts` — the only place any screen touches the network. Base URL from
  `NEXT_PUBLIC_API_BASE` (default: same-origin) so pointing at the Go gateway later is one env var.

Route handlers under `app/api/`:

| Route | Behaviour |
|---|---|
| `GET /api/courses` | Studio list. |
| `POST /api/courses/ingest` | Multipart (files + title/tagline/price). Writes the draft, then streams SSE: `status` lines → `draft` (id) → `result` \| `error`. |
| `GET /api/courses/[id]` | `?audience=public` applies `serializeCourse`. |
| `PATCH /api/courses/[id]` | Partial: title/tagline/price/lessons/positions/voice_card. |
| `POST /api/courses/[id]/publish` | Validates, sets `published`, returns `{slug, url}`. |
| `POST /api/courses/[id]/reingest` | Retry after a failure, reusing stored `source_text`. |
| `POST /api/courses/[id]/positions/[i]/soften` | Live mode only. |

`lib/extract.ts` turns uploads into text: `.md`/`.txt` direct, PDF via `unpdf`, and returns a
`no_text_layer` error when a PDF yields nothing — the trigger for the scan message.

`lib/ingest/prompt.ts` is the POC §Journey 1 ingestion prompt. `lib/ingest/live.ts` runs it through
the AI SDK's `generateObject` with the zod schema, honouring the repo's existing `MODEL_PROVIDER` /
`MODEL_NAME` convention (openai, anthropic). `lib/ingest/mock.ts` replays the fixture with staged
status lines (`READING 2 OF 6 FILES…`, `EXTRACTING POSITIONS…`, `WRITING LESSON 4 OF 7…`) paced by
`INGEST_MOCK_DELAY_MS` (0 in tests).

### Phase 3 — `/studio` and `/studio/new`

`/studio` (`app/studio/page.tsx`): a table, not cards (§11) — 2px rules, `label` caps headers,
`--paper-tint` zebra, hatch strip on draft rows, `RETRY` action on failed ones. Empty state is the
bordered box on halftone. One `lg accent` `BUILD A COURSE`.

`/studio/new`: `components/studio/Dropzone.tsx` — 3px **dashed** border (the only dashed border in
the system), halftone ground, copy in a floating `--paper` box, never text directly on halftone
(§4.14). Tabs for drop-files / paste-text. Then title, tagline, price inputs with the §4.10 invalid
treatment (alert border + hatch gutter + message) — price is required and integer dollars → cents.

`components/studio/IngestPanel.tsx` replaces the form on submit: bordered panel, halftone fill,
`meta` status line, `aria-live="polite"`, no percentage and no spinner. Reads the SSE stream via
`fetch` + `getReader()` (`EventSource` can't POST). On `result` → `/studio/:id`; on `error` →
`/studio/:id` in its failed state with `[RETRY INGESTION]`.

### Phase 4 — `/studio/:id`, the review screen

Tab bar (§4.11 file-folder tabs), 8/4 editor / public-preview split, defaulting to **Positions**.

- **Positions** — `components/course/PositionCard.tsx` in editable form, 2-up: claim (pink
  highlighter, `title` 22px — not caps), because (Newsreader `body-l`), pushback (pink-wash block),
  optional `▸ SOURCE` quote. Footer: `KEEP · SOFTEN · DELETE` as `sm` buttons, plus a dashed
  `+ ADD A STANCE` card at the end of the grid. Empty-state copy: *"We found 6 things you believe
  that most people don't. Your students are paying for these."* Thin results (<3) flip the default
  tab and reframe the heading.
- **Syllabus** — `@dnd-kit/sortable` reorder **plus** keyboard-accessible move up/down buttons
  (drag alone is not accessible and the design's tablet target needs a non-drag path). Inline-edit
  title and objective, collapsible `body_md` via `react-markdown`. `Merge` concatenates adjacent
  bodies and joins key points; `Split` opens a dialog to pick a paragraph boundary; `Delete`
  renumbers. All reducers are pure functions in `lib/reducers.ts` — that's what the unit tests hit.
- **Voice** — the voice card as editable free text areas (register, pet peeves, signature moves,
  refuses to), with the one line of guidance: *"How do you sound when you're explaining this at a
  bar?"*

Edits save through `PATCH` (debounced, optimistic, with a `meta` saved indicator). Header carries
`[PREVIEW AS A STUDENT]` and `[PUBLISH]`.

### Phase 5 — `/studio/:id/preview`, and publish

`components/learn/SyllabusRail.tsx` (§4.8 roman numerals, three states, greyscale-legible),
`ProgressMeter.tsx` (§4.9 discrete blocks, `140ms steps(1)`), `components/chat/Thread.tsx` +
`SpecialistTurn.tsx` / `SeekerTurn.tsx` (§4.6 asymmetric — no symmetric bubbles) and
`CitationChip.tsx`. Rendered inside a 3px inset with the pink `✕✕ PREVIEW — NOT LIVE ✕✕` strip.
Static: the draft's lessons in the rail, the scripted opening diagnostic as the one turn, composer
disabled. Journey 3 inherits all of these finished.

Publish: validates (title, tagline, price ≥ 1, ≥ 1 lesson), warns on thin positions without
blocking, sets `published`, and shows the shareable-link dialog.

### Phase 6 — Tests and CI

`vitest` unit tests on the pure layer:
`expected.json` parses · quote-anchor check passes for all 7 fixture quotes against `source.md`
(assertion A2, running in CI) · lesson reducers (reorder/merge/split/delete + renumber) · position
reducers · `serializeCourse('public')` omits `because`/`pushback`/`body_md` · slug and roman
numerals · thin-positions rule · `extract.ts` scan detection.

One `@playwright/test` smoke in mock mode with zero delay: upload `source.md` → `BUILD MY COURSE` →
review shows 7 positions → edit a claim → publish → published state and link.

Repo wiring: a `web` job in `.github/workflows/ci.yaml` (npm ci, lint, typecheck, vitest, build,
smoke) · `make web-dev` / `make test-web` in the `Makefile` · `services/web/Dockerfile` and a `web`
service in `compose.yaml` on port 3000 · `.env.example` gains `INGEST_MODE`, `INGEST_MOCK_DELAY_MS`,
`NEXT_PUBLIC_API_BASE` · a short `services/web/README.md`.

---

## Verification

```bash
cd services/web && npm ci
npm run seed            # optional: puts the fixture draft in /studio
npm run dev             # http://localhost:3000/studio
```

Walk the journey by hand: `/studio` empty state → `BUILD A COURSE` → drop
`docs/productDocs/fixtures/source.md` + title/tagline/price → watch the halftone ingest panel stream
status → review screen opens on Positions with 7 cards → reorder a lesson, soften a claim, edit the
voice card → `PREVIEW AS A STUDENT` → `PUBLISH` → link dialog.

Then the failure states: drop a scanned PDF (expect the paste message); set
`INGEST_MODE=live INGEST_FORCE_ERROR=1` (expect a retryable draft); load a course with two positions
(expect the Syllabus default and `WHERE STUDENTS GET STUCK`).

```bash
npm run lint && npm run typecheck && npm run test        # vitest
npm run test:e2e                                         # playwright smoke
INGEST_MODE=live MODEL_PROVIDER=anthropic npm run dev    # real ingestion, needs a key
```

Design check, per DESIGN §13: no pink text on white · no container radius between 1px and 998px ·
no blurred shadows or gradients · no third hue · no uppercase run over 8 words · no reading column
over 68ch · no eased transitions · no spinners or shimmer · no symmetric chat bubbles · locked
content withheld server-side, not CSS-blurred. Confirm the black 3px focus ring on every interactive
element and that `prefers-reduced-motion` stops the ticker, caret and progress snap.

---

## Explicitly not in this PR

Journey 2 (catalog, `/c/:slug`, sample chat, checkout) · Journey 3 (the tutor loop, streaming, the
four tools) · real ingestion in the Go gateway or a Temporal workflow · real auth · payments ·
Railway service creation for the web app.
