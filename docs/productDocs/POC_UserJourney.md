# Chat-Native Tutoring — POC Design Spec

**Scope:** one weekend, one engineer. Frontend → API → agent loop → Postgres. No vector DB, no payments integration, no recommendation algorithm.

---

## 0. Assumptions I've locked in (change if wrong)

| Question | POC answer |
|---|---|
| Auth | Dev-mode role switcher in the top-right: `Sign in as Specialist / Seeker`. Two seeded users. Real auth is a Monday problem. |
| Payments | `POST /enroll` writes a row. A fake checkout screen with a "Pay $X" button that sleeps 800ms. Stripe test mode only if you have 20 spare minutes. |
| Retrieval | **No RAG.** A course is < 60k tokens of text. Load the whole thing into the system prompt and cache it. Chunking + embeddings is the single biggest weekend time-sink and buys you nothing at this size. |
| File types | Markdown, `.txt`, and PDF-with-a-text-layer. Reject scans and video. |
| Model | One model for ingestion (bigger, slower is fine), one for chat (fast). |
| Multiplayer / cohorts | Out of scope. |

**The three journeys, and nothing else:**
1. Specialist publishes a course from raw material
2. Seeker evaluates a Specialist and buys
3. Seeker learns through interactive chat

---

## 1. Data model

```
users        id, name, role('specialist'|'seeker'), avatar_url, bio
courses      id, specialist_id, slug, title, tagline, price_cents,
             status('draft'|'published'), voice_card_json, positions_json,
             source_text (full raw text), created_at
lessons      id, course_id, ord, title, objective, key_points_json, body_md
enrollments  id, seeker_id, course_id, goal_text, created_at
progress     enrollment_id, lesson_id, status('locked'|'active'|'passed'), score
messages     id, enrollment_id, role('user'|'assistant'|'tool'),
             content, cited_lesson_ids_json, created_at
asks         id, enrollment_id, question, status('open'|'answered'), answer  -- stretch
```

`voice_card_json` and `positions_json` are what make this feel like *a person* and not ChatGPT with a textbook stapled to it.

```jsonc
// voice_card_json
{ "register": "blunt, uses shipping analogies, allergic to jargon",
  "pet_peeves": ["premature abstraction", "roadmaps beyond 6 weeks"],
  "signature_moves": ["always asks for the last concrete example first"] }

// positions_json  — the paid product
[ { "claim": "Never A/B test before 10k weekly actives",
    "because": "you'll ship noise and learn superstition",
    "pushback": "But my investors want data → data you can't trust is worse than none" } ]
```

---

## 2. Screens (8 total)

```
Seeker                              Specialist
──────────────────────────          ──────────────────────────
/            catalog                /studio          course list
/c/:slug     course + sample chat   /studio/new      upload
/checkout    fake pay               /studio/:id      syllabus editor
/learn/:id   the product            /studio/:id/preview
```

---

# Journey 1 — Specialist: raw material → published course

**Goal:** get from a folder of messy notes to a live course in under 10 minutes, without the Specialist ever writing a prompt.

### Flow

```
/studio/new
  ├─ 1. Drop files (md/txt/pdf)  +  title, tagline, price
  ├─ 2. [Build my course]  →  POST /api/courses/ingest
  │        ↓ single LLM call, streamed, ~30–60s
  │      returns { lessons[], voice_card, positions }
  ├─ 3. /studio/:id — review screen (see below)
  ├─ 4. [Preview as a student] → opens /learn in sandbox mode
  └─ 5. [Publish] → status='published', shareable link
```

### The review screen — the important one

Three tabs. Default to **Positions**, not Syllabus. This is a deliberate reframe: it tells the Specialist "your opinions are the asset," and it's the screen they'll actually want to edit.

- **Positions** — extracted stances as editable cards. Each card: *Claim / Because / When they push back*. Buttons: `Keep`, `Soften`, `Delete`, `+ Add a stance`. Empty state: "We found 6 things you believe that most people don't. Your students are paying for these."
- **Syllabus** — drag-reorderable lesson list. Inline-edit title + objective. Collapsible body. `Merge`, `Split`, `Delete`.
- **Voice** — the voice card as editable free text. One line of guidance: "How do you sound when you're explaining this at a bar?"

### Ingestion prompt (sketch)

```
You are turning one expert's raw material into a tutoring course.

Return JSON: { lessons: [{title, objective, key_points[], body_md}],
               voice_card: {...}, positions: [{claim, because, pushback}] }

Rules:
- 5–9 lessons. Each objective must be a capability ("can size a
  market from three numbers"), never a topic ("market sizing").
- POSITIONS: extract only claims this author would defend against a
  smart, disagreeing peer. Skip anything a textbook would also say.
  If the material contains no contested claims, return fewer — do
  not invent them.
- VOICE: infer from sentence rhythm, analogies, what they mock.
- Quote-anchor every position to the source text.
```

**Failure states to build:** no text extracted from PDF → "This looks like a scan. Paste the text instead." · fewer than 3 positions found → warn but allow publish · ingestion timeout → keep the draft, offer retry.

---

# Journey 2 — Seeker: evaluate → buy

**Goal:** replace "read 40 reviews and guess" with "argue with them for 3 minutes and know."

### Flow

```
/  catalog
   └─ cards: face, name, one-line credibility claim, price
       (no star ratings — deliberate, see below)

/c/:slug  course page
   ├─ Hero: Specialist's face, tagline, price
   ├─ "What I'll argue with you about" — 3 position cards, claims
   │   visible, `because` blurred with a lock icon
   ├─ ▸ THE SAMPLE CHAT  (the conversion mechanism)
   │     Live chat box, pre-seeded with 3 tappable prompts drawn
   │     from the positions:
   │        "Defend: never A/B test under 10k WAU"
   │        "What do most people get wrong here?"
   │        "I disagree with you about X"
   │     Hard limit: 5 exchanges. Then a soft wall, mid-conversation:
   │        "This is where I'd normally ask what you're building.
   │         Unlock the full course to keep going. — Rahul"
   ├─ Syllabus, collapsed, objectives only
   └─ [Get access — $X]
```

**Why no star ratings.** Your thesis is that the Seeker judges credibility *for themselves*. Averaged stars re-outsource that judgment and make every listing converge on 4.6. The sample chat is the review — it's non-fakeable and it's the product itself. This also spares you a whole ratings subsystem on a weekend.

**The wall must land mid-thought, not at a paywall banner.** Cutting off exactly when the conversation gets good is the entire conversion argument. Rate-limit by `localStorage` + IP; abuse isn't a POC concern.

### Checkout

```
/checkout → order summary → [Pay $X] → 800ms spinner → /learn/:id
```

One extra field on this screen, and it earns its place: **"What are you trying to do in the next 30 days?"** (free text, optional). Stored as `enrollments.goal_text` and injected into every future system prompt. This is your "learn faster" differentiator — the course reorders itself around a stated goal. It costs you one `<textarea>`.

---

# Journey 3 — Seeker: learn through chat

**Goal:** something a video course structurally cannot do — adapt, interrogate, and verify.

### Layout

```
┌──────────────┬─────────────────────────────────────┐
│ SYLLABUS     │  ┌───────────────────────────────┐  │
│              │  │ Rahul · Lesson 2 of 7         │  │
│ ✓ 1 Framing  │  └───────────────────────────────┘  │
│ ● 2 Sizing   │                                     │
│   3 Pricing  │       [ message thread ]            │
│   4 …        │                                     │
│              │   ┌─ citation chip ─────────┐       │
│ ── Progress  │   │ ▸ from Lesson 2         │       │
│ ▓▓▓░░░░ 30%  │   └─────────────────────────┘       │
│              │                                     │
│ [Ask Rahul]  │  [ input ]  [Skip ahead] [I'm lost] │
└──────────────┴─────────────────────────────────────┘
```

### The session opens with a diagnostic, not a lecture

First assistant turn, always:

> "Before I start — what's the thing you're actually trying to do? And what have you already tried that didn't work?"

Then it *visibly reorders the syllabus* and says which lessons it's skipping and why. That single moment is the whole pitch versus video: the course rearranged itself for you, in front of you, in ten seconds.

### The agent loop

Four tools. Resist adding a fifth.

```python
get_lesson(ord)                    # full body_md for one lesson
mark_progress(ord, status, score)  # drives the left rail
quiz(concept)                      # returns a checkpoint question
ask_specialist(question)           # queues to asks table  [stretch]
```

Loop: `user msg → model (system prompt + full course + positions + voice + goal_text + progress) → tool calls until no more → stream text`. Ten-turn cap per request. Persist every message.

### Tutor system prompt (sketch)

```
You are {name}, teaching {course}. Not an assistant — this person paid
for your specific opinions.

VOICE: {voice_card}
POSITIONS you hold and defend: {positions}
Their stated goal: {goal_text}
Progress: {passed lessons} / current: {active lesson}

Behaviour:
- Never lecture more than ~120 words without asking something back.
- If they disagree, defend the position using `pushback`. Concede only
  to a genuinely better argument, and say so plainly when you do.
- If asked something the course material doesn't cover, say
  "That's outside what I teach here" and call ask_specialist. Do not
  improvise expertise you weren't given — a wrong answer in {name}'s
  voice damages {name}.
- Every 3–4 exchanges, call quiz(). If they answer well,
  mark_progress(passed) and move on. If not, re-explain differently —
  a different analogy, not the same words slower.
```

### Details that make it feel finished

- **Citation chips.** Every substantive claim renders a `▸ from Lesson 3` pill that expands the source paragraph. Cheap (the model returns lesson ords), and it's your entire anti-hallucination story.
- **`I'm lost` button.** Sends a hidden turn: *re-explain that with a completely different analogy, assume no background.* One button, big effect.
- **`Skip ahead`.** Sends: *I know this, test me and move on.* Triggers `quiz()` immediately.
- **Progress ticks animate** when `mark_progress` fires. This is the only reward loop you get in a chat UI — don't waste it.
- **Resume.** Reopening `/learn/:id` replays the thread and reopens at the active lesson. Just `SELECT * FROM messages`.

---

## 3. API surface

```
POST /api/courses/ingest      files + meta → draft course        (Specialist)
PATCH /api/courses/:id        edit lessons/positions/voice        (Specialist)
POST /api/courses/:id/publish                                     (Specialist)
GET  /api/courses            catalog
GET  /api/courses/:slug      course page payload
POST /api/sample/:slug       5-turn ungrounded-in-full-text demo chat
POST /api/enroll             {course_id, goal_text} → enrollment
POST /api/chat               {enrollment_id, message} → SSE stream
GET  /api/enrollments/:id    messages + progress (resume)
```

---

## 4. Weekend build order

**Sat AM** — schema, seed one real course by hand (skip ingestion entirely at first). Get `/api/chat` streaming with a hardcoded system prompt. *If the chat isn't compelling with a hand-made course, no amount of ingestion polish saves it — so test the thesis here, before lunch.*

**Sat PM** — Journey 3 UI: thread, syllabus rail, tools, citation chips, progress. This is 60% of the work and 90% of the product.

**Sun AM** — Journey 1: ingestion endpoint + review screen. Positions tab only if time is tight; syllabus editing can be raw JSON.

**Sun PM** — Journey 2: catalog, course page, sample chat, fake checkout, goal field. Then record a 90-second demo.

**Cut list, in order:** `ask_specialist` → the Voice tab → PDF parsing (paste-only) → the catalog page (deep-link one course).

---

## 5. The one thing to watch in the demo

Whether the Seeker **argues back**. If people treat it as a search box, you've built a chatbot over a PDF. If they push back on a position and it holds its ground and they change their mind — that's the thing video can't do, and it's the only signal from this POC that's worth anything.
