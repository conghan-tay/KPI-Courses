# The Reverse Interview — POC Design Spec

**The premise** (`TheReverseInterview/originalIdea.txt`): a recruiter has to get approved,
spend an hour with a chatbot that knows the candidate, pay for that hour, and pass a
four-question test before they are allowed to book twenty minutes of the candidate's
actual time. The candidate stops repeating themselves; the recruiter has to demonstrate
they did the reading.

The point is not a formal representation of a candidate. It is a **richer** one than a CV
or a LinkedIn profile can hold — what they actually did, what they are good at, what they
are not, what they want next.

**Scope of this repository, today: Journey 1 only.** The candidate's authoring journey —
documents in, knowledge base out. Journeys 2 and 3 are specified here at the level needed
to not paint them into a corner, and are not built.

---

## 0. Assumptions locked in (change if wrong)

| Question | POC answer |
|---|---|
| Auth | Dev-mode role switcher, top right: `Sign in as Candidate / Recruiter`. Two seeded users. LinkedIn OAuth, the email approve/reject loop and magic links are all real-auth problems, deferred. |
| Payments | Not built. Pricing is platform-fixed and appears as copy: $3.00 + model cost for the hour, $20 for twenty minutes of the candidate's time. Nothing takes a card. |
| Retrieval | **No RAG.** A knowledge base is under 60k tokens of text. The whole thing goes in the system prompt and gets cached. Chunking and embeddings buy nothing at this size. |
| File types | Markdown, `.txt`, and PDF-with-a-text-layer. Reject scans and video. |
| Model | One model for ingestion (bigger and slower is fine). The chat model is Journey 3's problem. |
| Candidates per account | One candidate, many knowledge bases. Versions and drafts are free; nothing in the schema assumes a single one. |

**The three journeys:**

1. **Candidate publishes a knowledge base** from their documents ← *this repository*
2. **Recruiter is approved, pays, and spends an hour with the agent**
3. **Recruiter passes the gate and books twenty minutes**

---

## 1. Data model

```
users            id, name, role('candidate'|'recruiter'), avatar_url, bio
knowledge_bases  id, candidate_id, slug, title, tagline,
                 status('draft'|'published'), ingest_status, ingest_error,
                 pre_roll_json, chips_json, quiz_json,
                 source_text (full raw text), source_files, created_at, updated_at
kb_sections      id, kb_id, ord, path, anchor, title, summary, body_md
```

Journeys 2 and 3 add `recruiters` (approval state), `sessions` (the hour, its meter and
its transcript), `messages`, `gate_attempts` and `bookings` alongside these.

### The knowledge base is the product

`kb_sections` is what the candidate publishes and what the agent will speak from. A
section is addressed by **`path#anchor`** — `agoda/psp-routing#circuit-breakers` — and
that id is the join key for everything else. `anchor` may be empty, in which case the id
is just the path.

```jsonc
// one row of kb_sections
{ "ord": 7, "path": "agoda/psp-routing", "anchor": "circuit-breakers",
  "title": "PSP circuit breakers, and the incident that reshaped them",
  "summary": "One breaker per PSP per corridor. Opens on five consecutive failures…",
  "body_md": "…" }
```

### The three generated artifacts

```jsonc
// chips_json — 8 generated, the candidate picks 3 for the front page
[ { "text": "why did he leave agoda?",
    "kb_section": "career/timeline#agoda-exit",
    "register": "blunt",
    "selected": true,
    "why_it_lands": "Blunt, and every recruiter asks it eventually. On the front page it
                     signals nothing is being managed." } ]

// quiz_json — 12 items, 3 per category. The gate samples one per category.
[ { "id": "q08", "category": "limits",
    "question": "What is his actual relationship to NodusArt?",
    "choices": ["Founding engineer", "Unpaid advisor — no commits, no equity, no on-call",
                "Contract backend developer", "He built their smart contracts"],
    "correct_index": 1,
    "rationale": "The KB is deliberate about not upgrading this into 'Web3 engineer'.",
    "source_section": "nodusart/advisory" } ]

// pre_roll_json — what's loaded, before the timer starts
{ "headline": "Sixty minutes. Starts when you hit send.",
  "bullets": ["Full timeline, four employers, gap included",
              "Six systems I built, at architecture depth",
              "Bring your band — it'll say if it clears",
              "Opinions I'll defend and can't be talked out of"] }
```

Authoring rules for all three live in `TheReverseInterview/chips_example_prompt.txt`,
`quiz_example_prompt.txt` and `pre_roll_wireframe.txt`. Two conflicts between those files
and the example JSON beside them are resolved in `fixtures/README.md`.

---

## 2. Screens

```
Candidate                              Recruiter
──────────────────────────────         ──────────────────────────────
/studio          KB list               /k/:slug     pre-roll + 3 chips
/studio/new      upload                /hour/:id    the hour           (J2)
/studio/:id      review                /gate/:id    four questions     (J3)
/studio/:id/preview                    /book/:id    calendar           (J3)
```

Journey 1 builds the left column and the public projection behind `/k/:slug`.

---

# Journey 1 — Candidate: documents → published knowledge base

**Goal:** from a folder of CVs, design docs and notes to a live knowledge base in under
ten minutes, without the candidate ever writing a prompt.

### Flow

```
/studio/new
  ├─ 1. Drop files (md/txt/pdf)  +  display name, one line
  ├─ 2. [Build my knowledge base] → POST /api/kb/ingest
  │        ↓ a multi-step pipeline, streamed, ~60–120s
  │      returns { sections[], chips[8], quiz[12], pre_roll }
  ├─ 3. /studio/:id — review screen (below)
  ├─ 4. [Preview as a recruiter] → the pre-roll card and the 3 chosen chips
  └─ 5. [Publish] → status='published', shareable link
```

### The review screen

Four tabs. Default to **Chips**, not the knowledge base. That is the deliberate reframe:
it tells the candidate *these are the eight questions a recruiter types first — pick the
three that go on your front page*, which is the decision they will actually want to make.

- **Chips · 8** — the generated openers as editable cards. Each shows its register, the
  section it draws on, and `why_it_lands`. Buttons: `Select`, `Rephrase`, `Delete`,
  `+ Add a question`. A counter enforces exactly three selected. Empty state: *"We found
  eight things a recruiter would type first. Pick the three worth the front page."*
- **Knowledge base · N** — reorderable section list, inline-edit title and summary,
  collapsible body. A section whose id no chip or quiz item references is fine; a chip
  pointing at a section that does not exist is flagged.
- **Quiz · 12** — grouped by category, four choices each, one marked correct. Warns on a
  question answerable by ctrl-F and on a category with fewer than three items.
- **Pre-roll** — headline and four bullets, rendered live inside the wireframe card.

### The pipeline

Not one call. Sections must exist before anything can reference them, so:

```
sanitize → segment → read_segment*  → plan_sections → write_section*
  → generate_chips → generate_quiz → verify_refs ⇄ repair_refs
  → write_pre_roll → assemble
```

Rules the prompts carry, and the code enforces a second time:

- **No invention, and no upgrading.** An unpaid advisory seat is an unpaid advisory seat.
  A stated limit is stated, not softened. This is the whole product: an agent that
  flatters the candidate misrepresents them to a recruiter, in their name.
- **Every chip and every quiz item names a section**, and the reference must resolve. A
  reference that still does not resolve after one repair pass is cleared, and the review
  screen shows the card as unsourced rather than shipping a fabricated citation.
- **Caps in code as well as in the prompt** — 16 sections, 8 chips, 12 quiz items, 4
  choices per item.

**Failure states to build:** no text extracted from a PDF → *"This looks like a scan.
Paste the text instead."* · fewer than 8 chips or an empty quiz category → warn but allow
publish · ingestion timeout → keep the draft, offer retry. The draft row is written
*before* the model is called, which is the only thing that makes a retry possible.

### Publish blockers

Needs a display name · needs a one-liner · at least one section · exactly three chips
selected · at least four quiz items covering all four categories · ingestion not still
running. Everything else warns. A candidate with a thin corpus still has a knowledge base
worth publishing, and a hard gate there tells a perfectly reasonable person that their
history is not interesting.

---

# Journey 2 — Recruiter: approved, paying, and one hour

Not built. Specified only so Journey 1 does not foreclose it.

```
/k/:slug   the public page
   ├─ Pre-roll card: headline, 4 bullets, "$3.00 + model cost. Meter visible throughout."
   ├─ The 3 selected chips, tappable
   └─ [ START MY HOUR ]  → sign in with LinkedIn → approval pending
```

Signup notifies the candidate by email with a link to the recruiter's LinkedIn profile and
Approve / Reject buttons. Only an approved recruiter gets a magic link. The hour starts on
first send, a timer and a running cost meter are visible throughout, and when it expires
the chat disables and an invoice appears: a fixed $3 plus the model cost actually incurred.

**What the public projection must withhold**, and why it is engineering rather than
styling: `quiz` in full — a leaked `correct_index` defeats the gate that Journey 3 is
built on — plus `why_it_lands`, section bodies, and `source_text`. Withheld server-side,
in `ToPublic`. Rendering it and hiding it in CSS is one devtools inspection from giving
away the product and the answer key.

---

# Journey 3 — Recruiter: the gate, then twenty minutes

Not built.

After payment: continue the chat, or book. Booking requires **four multiple-choice
questions, sampled one per category from the twelve, all four correct**. Unlimited
retries. On failure, show which were wrong and never the correct answer, and **resample on
retry** so a reload is not a free coin flip.

Then a calendar, an authorised charge, and — once the candidate approves the request by
email — payment settles and a Google Meet invite goes out.

---

## 3. API surface

```
POST  /api/kb/ingest                    files + meta → draft KB + SSE   (Candidate)
PATCH /api/kb/:id                       edit sections/chips/quiz/pre-roll
POST  /api/kb/:id/publish
POST  /api/kb/:id/reingest              retry from stored source text
POST  /api/kb/:id/chips/:index/rephrase
GET   /api/kb                           the candidate's list
GET   /api/kb/:id                       owner's copy
GET   /api/kb/:id?audience=public       the projection a stranger gets
```

Journey 2 adds `/api/recruiters/*`, `/api/sessions/*` and `/api/chat`; Journey 3 adds
`/api/gate/*` and `/api/bookings/*`.

---

## 4. The one thing to watch in the demo

Whether the knowledge base is **more honest than a CV**, not just longer than one. The
whole bet is that a candidate will say "seven years stale" and "no equity, no commits" out
loud because doing so buys them a recruiter who is not wasting their afternoon. If the
generated knowledge base rounds those up into strengths, the product is a CV generator
with extra steps, and the assertion to run is `fixtures/README.md` B3.
