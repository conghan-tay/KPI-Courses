# Pivot: Chat-Native Tutoring → The Reverse Interview

## Context

The repo currently implements Journey 1 of `docs/productDocs/POC_UserJourney.md`: a
**Specialist** uploads raw material and a Temporal/LangGraph pipeline turns it into a
**course** — `lessons[]`, `positions[]`, `voice_card` — which they review and publish for
**Seekers** to buy.

`docs/productDocs/TheReverseInterview/originalIdea.txt` replaces the product. A
**Candidate** uploads documents about themselves; a vetted **Recruiter** pays for an hour
with a chatbot that knows them, then must pass a four-question gate before booking twenty
minutes of the candidate's real time. The candidate does not publish a course — they
publish a **knowledge base**.

This plan covers **only the candidate's authoring journey**: upload documents → generate
the knowledge base, chips, quiz and pre-roll → review → publish. The recruiter side
(LinkedIn signup, approval email, magic link, the hour timer and cost meter, payments,
the quiz gate itself, booking) is explicitly out of scope.

The architecture is retained wholesale: Next.js BFF → Go gateway → Temporal → LangGraph
worker → Postgres, with `MODEL_PROVIDER=fake` replaying a fixture for deterministic,
key-free CI. The RISO POSTER design language in `docs/productDocs/DESIGN.md` is unchanged.

### Decisions taken (confirmed with the user)

| Decision | Choice |
|---|---|
| What `kb_section` / `source_section` point at | **Generated KB sections** — the direct structural replacement for `lessons`, same table, same write-loop. Chips and quiz reference them by id, and ref-resolution becomes the new code-enforced hallucination canary. |
| Rename depth | **Full domain rename.** course→knowledge_base, specialist→candidate, seeker→recruiter, through Go packages, Python modules, SQL, TypeScript, routes and docs. |
| Fixture | **Author a new one.** A candidate corpus in the payments-engineer persona that `chips.json` and `quiz.json` already describe, plus a new `expected.json`. |
| `price_cents` | **Dropped.** Pricing is platform-fixed ($3 + model cost per hour); it becomes static copy on the pre-roll card. |

---

## 1. The artifact mapping

| Today | Becomes | Shape | Storage |
|---|---|---|---|
| `lessons[]` | `sections[]` — the knowledge base | `{ord, path, anchor, title, summary, body_md, source_names[]}`; id is `path#anchor`, e.g. `agoda/psp-routing#circuit-breakers` | `kb_sections` table (was `lessons`), addressed by ordinal and by id |
| `positions[]` | `chips[]` | `{text, kb_section, why_it_lands, register, selected}` — 8 generated, exactly 3 selected | JSONB on the KB row |
| `voice_card` | `pre_roll` | `{headline, bullets[4]}` | JSONB on the KB row |
| — | `quiz[]` | `{id, category, question, choices[4], correct_index, rationale, source_section}` — 12 items, 3 per category | JSONB on the KB row |

Sources of truth: `docs/productDocs/TheReverseInterview/{chips,quiz,pre_roll}.json` and the
two prompt files beside them.

**Two additions to the supplied JSON, both load-bearing:**

- `chips[].register` (`skeptical` \| `narrative` \| `blunt`) and `chips[].selected` — the
  chips prompt demands a register mix, and `chips.json`'s own description says *"Generate
  eight, candidate picks three."* Selection has to live somewhere.
- `quiz[].category` (`motivation` \| `judgement` \| `limits` \| `substance`) — the quiz
  prompt defines four categories × three questions, and the gate samples exactly four.
  One per category is obviously the intended sample, so the category must be stored.

**A conflict to flag, not silently resolve:** `quiz_example_prompt.txt` says *"Anything
answerable by ctrl-F… If the answer is a number, delete the question."* But `quiz.json`'s
own q04 ("How many mismatch classes… → Four") and q09 ("About 94%") are exactly that.
Treat the prompt as the newer intent and implement the check as a **review-screen warning**
(`This one is answerable by ctrl-F`), not a drop — dropping would gut the example data.

---

## 2. The graph (`services/agent`)

Sections must exist before chips or quiz can reference them, so the pipeline reorders:
section-writing moves ahead of chip generation, where lesson-writing used to sit behind
position resolution.

```
sanitize → segment → read_segment* → plan_sections → write_section*
  → generate_chips → generate_quiz → verify_refs ⇄ repair_refs
  → write_pre_roll → assemble
```

Node-by-node, against `services/agent/app/graph/ingest.py`:

| Node | Derived from | Change |
|---|---|---|
| `sanitize` | `sanitize` | Unchanged. Reuse `inspect_user_text` from `app/core/safety.py`. |
| `segment` | `segment` | Unchanged. Reuse `split_corpus` and the `# SOURCE FILE: ` header written by `joinCorpus` in `services/web/lib/extract.ts`. |
| `read_segment` (loop) | `read_segment` | Retarget. Classify kind as `resume` \| `system_writeup` \| `transcript` \| `review` \| `notes` \| `unknown`; emit `section_candidates`, `facts`, `opinions_held`, `stated_limits`, `motivations` in place of `candidates`/`craft_points`. |
| `plan_sections` | `plan_lessons` | Same shape. Plans 6–12 sections with `path`, `anchor`, `title`, `source_names[]`. Keep `material_for()` verbatim. |
| `write_section` (loop) | `write_lesson` | Same self-loop, one activity per section, same honest status line. Prompt swaps "teach a capability" for "state what he owned, at architecture depth, without upgrading it." |
| `generate_chips` | `resolve_positions` | 8 chips from section titles + summaries. Register mix enforced in the prompt; **the code default-selects the first three**, so `selected` is never empty. |
| `generate_quiz` | *new* | 12 MCQs. Code caps at 12 and enforces 4 choices + `0 ≤ correct_index ≤ 3`, dropping malformed items — the same "enforce twice" discipline as today's `by_author=false` drop. |
| `verify_refs` | `verify_quotes` | Pure. Every `chips[].kb_section` and `quiz[].source_section` must resolve to a written section id. Exact match after slug normalisation. |
| `repair_refs` | `repair_quotes` | One bounded pass; matched **by chip text / question text**, not by index, for the same reason the existing code matches by claim. Loops back to `verify_refs`. |
| `write_pre_roll` | `read_voice` | Reads section summaries rather than raw excerpts. Returns a headline + exactly 4 bullets. |
| `assemble` | `assemble` | Renumber section ordinals; clear refs that still do not resolve; ensure exactly 3 chips selected; log thin results (< 6 sections, < 8 chips, < 12 quiz items, any empty quiz category). |

Files:

- `app/core/course_schemas.py` → `app/core/kb_schemas.py`. `Position`→`Chip`,
  `Lesson`→`Section`, `VoiceCard`→`PreRoll`, add `QuizItem`; `CandidateClaim`/
  `SegmentReading`/`LessonPlan` → `SectionCandidate`/`SegmentReading`/`SectionPlan`.
  (Note: `Candidate` is now a *person* in this domain — name the graph type
  `SectionCandidate` to avoid the collision.)
- `app/graph/prompts.py` — rewrite. Port `chips_example_prompt.txt` and
  `quiz_example_prompt.txt` in near-verbatim; keep the `_SOURCE_DATA_RULE` prefix on every
  prompt that touches the corpus.
- `app/graph/anchors.py` → `app/graph/refs.py`. Keep `normalize_for_match`; replace
  `unanchored_indexes` with `unresolved_indexes(refs, section_ids)`.
- `app/graph/soften.py` → `app/graph/rephrase.py` (rephrase a chip in a different
  register — the natural analogue of "soften a claim", and it keeps the fake-mode
  determinism that stops the button ever being dead).
- `app/graph/ingest_state.py` — rename state keys to match.
- `app/core/ingest_model.py` — one method per new step on `IngestionModel`;
  `FixtureIngestionModel` replays the new `expected.json`.
- `app/core/settings.py` — `max_lessons`→`max_sections` (12), `max_positions`→`max_chips`
  (8), add `max_quiz_items` (12), `max_quote_repairs`→`max_ref_repairs`.
- `app/temporal/course_workflow.py` → `app/temporal/kb_workflow.py`.
  `CourseIngestionWorkflow`→`KnowledgeBaseIngestionWorkflow`,
  `SoftenClaimWorkflow`→`RephraseChipWorkflow`. The `get_progress` query and
  `add_progress` signal keep their names and their dedup logic.

Status lines (the SSE stream the panel renders):
`READING 1 OF 7 FILES · resume.md` · `PLANNING THE KNOWLEDGE BASE…` ·
`WRITING SECTION 3 OF 9 · PSP ROUTING` · `DRAFTING OPENING QUESTIONS · 8 FOUND` ·
`WRITING THE GATE QUIZ · 12 QUESTIONS` · `CHECKING SECTION REFERENCES…` ·
`WRITING THE PRE-ROLL…`

---

## 3. The gateway (`services/gateway`)

- Module path `github.com/example/kpi-courses/...` → `github.com/example/reverse-interview/...`
  (mechanical, touches every import).
- `internal/courses/` → `internal/kb/`. `courses.go` keeps its structure exactly:
  `NewDraft`, `ApplyIngestResult`, `MarkIngestFailed/Running`, `ApplyPatch`, `Renumber`,
  `PublishBlockers`, `ToPublic`, `ToSummary`, `Slugify`, `PublicURL`. `ingest.go` and
  `runtime.go` change only in names — the completion watcher, `Reconcile`, the poll loop
  and the "terminal state from the database" rule are untouched.
- `internal/api/types.go` — the three-way contract. `Course`→`KnowledgeBase`,
  `Lesson`→`Section`, `Position`→`Chip`, `VoiceCard`→`PreRoll`, add `QuizItem`. Drop
  `PriceCents` everywhere including `IngestRequest` and `CoursePatch`.
- **`PublishBlockers`** (`internal/kb/kb.go`):
  needs a title · needs a tagline · at least one section · exactly 3 chips selected ·
  at least 4 quiz items covering 4 distinct categories · `ingest_status != running`.
  Thin-but-legal results (8 chips not reached, fewer than 12 quiz items) **warn and never
  block**, preserving today's stance in `PublishBlockers`.
- **`ToPublic`** — still an allowlist, and now genuinely security-critical rather than
  just conversion-critical: the projection returns the pre-roll and the 3 selected chips'
  `text` only. It **withholds the entire quiz** (a leaked `correct_index` defeats the
  booking gate), `chips[].why_it_lands` (the candidate's private reasoning),
  section bodies, and `source_text`. Section `title` + `summary` are public.
- `POST /v1/courses/{id}/positions/{index}/soften` →
  `POST /v1/knowledge-bases/{id}/chips/{index}/rephrase`; the rest of the routes in
  `internal/httpapi/handler.go:91-100` rename in place. Rename the parked Chroma route
  `POST /v1/knowledge` → `POST /v1/vectors` so it does not read as a sibling of
  `/v1/knowledge-bases`.
- `cmd/seed` — seeds the new fixture straight to `ready`.

### Migration

Rewrite `internal/store/migrations/0001_init.sql` rather than adding `0002`: there is no
production data and the pivot is total.

**Gotcha to call out in the PR:** `migrate.go` records applied migrations in
`schema_migrations`, so an edited `0001_init.sql` will *not* re-run against an existing
volume. `docker compose down -v` (or `make down`) is required once. `make test-e2e`
already starts with `down -v`, so CI is unaffected.

```
users            id, name, role('candidate'|'recruiter'), bio, avatar_url
knowledge_bases  id, candidate_id, slug, title, tagline, status, ingest_status,
                 ingest_error, pre_roll JSONB, chips JSONB, quiz JSONB,
                 source_text, source_files JSONB, created_at, updated_at
kb_sections      id, kb_id, ord, path, anchor, title, summary, body_md,
                 UNIQUE (kb_id, ord), UNIQUE (kb_id, path, anchor)
```

Seeded users become the candidate from the new fixture and one recruiter. Keep the
whole-list-rewrite-in-one-transaction trick for section patches — it is what sidesteps
`UNIQUE (kb_id, ord)` collisions mid-reorder.

---

## 4. The web app (`services/web`)

`lib/extract.ts`, `lib/frontmatter.ts`, `lib/gateway.ts`, `lib/session.ts` and everything
under `components/frame/` and `components/ui/` are domain-agnostic — **reuse unchanged**
apart from the cookie name and header names.

- `lib/types.ts` — mirror the Go structs; `PositionSchema`→`ChipSchema`,
  `LessonSchema`→`SectionSchema`, `VoiceCardSchema`→`PreRollSchema`, add `QuizItemSchema`
  (`.length(4)` on choices, `correct_index` `int().min(0).max(3)`). Drop `price_cents`.
- `lib/quotes.ts` → `lib/refs.ts`. `isQuoteAnchored`→`isRefResolved`,
  `auditAnchors`→`auditRefs`, `isThinOnPositions`→`isThinOnChips`. Keep
  `normalizeForMatch` verbatim.
- `lib/seed.ts` — candidate + recruiter; cookie `kap_user` → `tri_user`.
- `lib/reducers.ts` — chip and quiz-item reducers replacing the position ones.
- `app/api/courses/**` → `app/api/kb/**`; every handler stays a thin `proxyJson` /
  `proxyStream` in front of `lib/gateway.ts`, except `ingest`, which keeps its multipart
  parsing and `extractFile` call so the designed **"This looks like a scan. Paste the
  text instead."** state survives verbatim.
- Routes keep `/studio`, `/studio/new`, `/studio/[id]`, `/studio/[id]/preview` — "studio"
  is not course vocabulary. `PublicURL` mints `/k/:slug` instead of `/c/:slug`.

### `/studio/new`

Same dropzone, same three-failure-state handling. Form fields become **Display name**
(→ `title`) and **One line** (→ `tagline`); the Price field is deleted. Frontmatter
autofill in `NewCourseForm.addFiles` still applies, minus `price_cents`. Button copy:
`BUILD MY KNOWLEDGE BASE`.

### `/studio/[id]` — the review screen

Four tabs, **defaulting to Chips**. That default carries the same reframe today's
Positions default does: *these are the eight questions a recruiter types first — pick the
three that go on your front page.*

| Tab | From | Content |
|---|---|---|
| **Chips · 8** | `PositionsTab.tsx` → `ChipsTab.tsx` | 8 chip cards; edit `text`, see `why_it_lands` and the linked section; `SELECT` / `REPHRASE` / `DELETE`; a counter enforcing exactly 3 selected. Unresolved `kb_section` flags the card, exactly as `unanchoredClaims` flags a position today. |
| **Knowledge base · N** | `SyllabusTab.tsx` → `SectionsTab.tsx` | Reorderable section list, inline-edit title + summary, collapsible body. |
| **Quiz · 12** | *new* `QuizTab.tsx` | Grouped by category. Edit question, four choices, correct answer, rationale. Warn on a bare-numeric answer (§1) and on an empty category. |
| **Pre-roll** | `VoiceTab.tsx` → `PreRollTab.tsx` | Headline + 4 bullets as free text, rendered live against the `pre_roll_wireframe.txt` card. |

`PublicPreviewPanel` keeps its role and its `refreshKey={kb.updated_at}` trick, now
proving that the quiz and `why_it_lands` are absent from the public payload.
`components/course/PositionCard.tsx` → `components/kb/ChipCard.tsx`;
`components/learn/*` → `components/interview/*`, with `LearnPreview` becoming the
pre-roll + chips landing preview behind `/studio/[id]/preview`.

---

## 5. The fixture (`docs/productDocs/fixtures/`)

Rebuild for the persona `chips.json` and `quiz.json` already describe — a payments
engineer, ex-Agoda, unpaid NodusArt advisor, honest about stale ML. Seven source files, so
the read loop is genuinely exercised and every referenced section has real material:

```
resume.md               timeline, four employers, the gap
agoda-payouts.md        supplier payouts, virtual card issuance, idempotency key
agoda-psp-routing.md    circuit breakers, the PSP-B latency incident, deferred state
agoda-reconciliation.md the Spark pipeline, four mismatch classes, ~94% auto-resolve
postgres-opinions.md    queue workers, READ COMMITTED + SKIP LOCKED, why not SERIALIZABLE
nodusart-advisory.md    honest scope: no commits, no equity; content hash on chain
career-notes.md         why he left, what he wants next, ML ~7 years stale
expected.json           { kb, sections[], chips[8], quiz[12], pre_roll }
```

`chips.json`'s eight entries and `quiz.json`'s twelve become `expected.json` verbatim,
plus the new `register` / `selected` / `category` fields. `expected.json` must parse
against the zod schemas — the existing `lib/types.test.ts` pattern covers this.

**New assertions**, replacing A1–A7 in `fixtures/README.md`:

- **B1 — section shape.** 6–12 sections; every id is `path#anchor`, slug-safe, unique.
- **B2 — reference resolution.** Every `chips[].kb_section` and `quiz[].source_section`
  resolves to a real section id. A string match, run in CI *and in the product* — the
  direct replacement for A2, and the same hallucination canary.
- **B3 — no invention.** The KB must not upgrade the NodusArt advisory into "Web3
  engineer", and must state the ML gap. (Judgement — `make eval` only.)
- **B4 — the gap is included.** The employment gap appears in the timeline, unsmoothed.
- **B5 — limits are surfaced.** The honest-limits material produces at least one `limits`
  quiz item rather than being buried.
- **B6 — chip register mix.** 8 chips, all three registers present, every one under 12
  words, none revealing its own answer. Word count is a code check; the rest is eval.
- **B7 — quiz balance.** 12 items, 3 per category, exactly 4 choices, distractors that a
  competent generic senior engineer would give. Counts in code, distractor quality in eval.
- **B8 — the ctrl-F rule.** Warn (never drop) on items whose correct answer is a bare
  number. See the §1 conflict note.

---

## 6. Docs

- New `docs/productDocs/POC_UserJourney.md` describing the three reverse-interview
  journeys, with only Journey 1 specified in build detail. Keep the old file as
  `POC_UserJourney_Tutoring.md` or delete it — it is the source of dozens of code
  comments that will now be stale either way.
- `docs/productDocs/DESIGN.md` — token, pattern, motion and layout rules are unaffected.
  Update §4.5 (position card → chip card), §4.8/§4.9 (syllabus rail → section index),
  §11 (screen list, price block removed, pre-roll card added from
  `pre_roll_wireframe.txt`).
- `README.md`, `Makefile` (`seed-course` → `seed-kb`), `compose.yaml` service/db names.

---

## 7. Suggested sequence

Five steps, each independently reviewable; 1–3 land together or the stack does not build.

1. **Contract + fixture** — new `POC_UserJourney.md`, the seven source files,
   `expected.json`, and the schema triple (`kb_schemas.py`, `api/types.go`, `types.ts`).
2. **Agent** — prompts, graph nodes, `refs.py`, fixture model, workflow rename; unit tests
   in `services/agent/tests/` retargeted.
3. **Gateway** — module rename, `internal/kb`, migration, routes, seed; `kb_test.go` and
   `handler_test.go` retargeted.
4. **Web** — types, api-client, routes, the four review tabs, component renames.
5. **Tests + docs** — `tests/e2e/`, the Playwright spec, `make eval`, README, Makefile,
   `DESIGN.md`.

---

## 8. Verification

```bash
make lint          # ruff · gofmt/vet/go test -race · eslint/tsc/vitest
make test-unit
make down          # REQUIRED ONCE — 0001_init.sql was rewritten in place
make test-e2e      # browser smoke first, then the SSE/API suite
```

`make test-e2e` should assert, on `MODEL_PROVIDER=fake`:

- the Playwright smoke (`services/web/e2e/`) walks empty studio → drop the fixture files →
  `BUILD MY KNOWLEDGE BASE` → review screen opens on **Chips · 8** with 3 selected →
  edit a chip and let the debounce land → publish → the public preview shows the pre-roll
  and 3 chip texts and **no quiz anywhere in the payload**;
- `tests/e2e/` reads the SSE response directly and asserts the status frames in order
  (the browser cannot — fixture replay finishes in about a second), then the full KB
  payload: 6–12 sections, 8 chips, 12 quiz items, 4 pre-roll bullets, and B2 ref
  resolution across every chip and quiz item.

By hand against `make run`, re-running the durability claims the README makes (these are
what the Temporal architecture is *for*, and the pivot touches the node graph they run):

- close the tab immediately after the `draft` frame → the KB still reaches `ready`;
- restart the gateway mid-run → it logs re-attachment and finishes;
- stop and restart the worker → the queued workflow is picked up and completes;
- publish twice with the same display name → unique slugs.

`make eval` (needs a real key, costs money) for B3, B5, B6 and B7 — the judgement
assertions the fixture model structurally cannot check, since it replays the right answer.

---

## Explicitly not in this plan

Recruiter LinkedIn signup and the email approve/reject loop · magic links · the one-hour
timer, cost meter and chat transcript · the summarise-and-download-PDF button · payments
and invoicing · the four-question gate UI and its resample-on-retry rule · calendar
booking and Google Meet invites · the recruiter-facing chat itself. Those consume the
quiz, chips and pre-roll this journey produces; none of them are built here.
