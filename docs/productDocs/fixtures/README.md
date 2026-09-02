# Fixture: `arun-velasco`

One end-to-end test case for `POST /api/kb/ingest` — a Candidate's documents turned into a
published knowledge base, chips, quiz and pre-roll.

```
resume.md                → frontmatter carries title / tagline; body is the CV
agoda-supplier-payouts.md  agoda-psp-routing.md  agoda-reconciliation.md
postgres-notes.md          nodusart-advisory.md  career-notes.md
expected.json            → the reference output: { kb, sections[], chips[], quiz[], pre_roll }
```

**The candidate is fictional.** Deliberately, exactly as the previous fixture was: this
file is committed, replayed in CI and rendered in a browser smoke test, and personal
history does not belong in any of those. The *material* is the persona that
`../TheReverseInterview/chips.json` and `quiz.json` already describe — a payments
engineer, ex-Agoda, unpaid NodusArt advisor, honest about stale ML — so every
`kb_section` and `source_section` those two files reference has real text behind it here.

The corpus is ~5,200 words across seven files. Real input is far larger, but a fixture you
can run twenty times in an hour is worth more than a realistic one you run twice.

## What the corpus is made of

Seven heterogeneous files, matching what a candidate actually has lying around:

| File | Kind | Role in the test |
|---|---|---|
| `resume.md` | CV | The timeline, four employers, and the gap. Frontmatter autofills the form. |
| `agoda-supplier-payouts.md` | System write-up | Densest source. Three sections come out of it. |
| `agoda-psp-routing.md` | System write-up | Carries both "decisions I got wrong" — the error-only breaker and the missing `deferred` state. |
| `agoda-reconciliation.md` | System write-up | Numbers, classes, and an explicit paging policy. |
| `postgres-notes.md` | Opinion notes | Where the defensible opinions live. |
| `nodusart-advisory.md` | Scope note | **The no-invention trap.** |
| `career-notes.md` | Personal notes | Motivations, refusals, the band, and the stated limits. |

## Assertions

**B1 — section shape.** 10–16 sections. Every id is `path` or `path#anchor`, slug-safe
(`[a-z0-9/#-]`), and unique within the knowledge base. `expected.json` has 14. Ordinals
are 1..n with no gaps — the gateway assigns them, so the graph's numbering is not trusted.

**B2 — reference resolution.** Every `chips[].kb_section` and every
`quiz[].source_section` must resolve to a section id that exists. This is the one
assertion that is a plain string match, and it is the highest-value one — it is the
hallucination canary, the direct replacement for the old fixture's quote-anchoring check.
It runs in CI *and inside the product*: `verify_refs` in the graph, `auditRefs` on the
review screen. All 20 references in `expected.json` resolve today; run the check on your
own output.

**B3 — the no-invention trap (`nodusart-advisory.md`).** The knowledge base must not
upgrade an unpaid advisory seat into engineering work. Specifically, none of these may
appear as a claim about him: *founding engineer*, *contract developer*, *built their smart
contracts*, *Web3 engineer*. He explicitly says he would push back on a CV implying any of
them, and a candidate brief that quietly upgrades this has lied to a recruiter on his
behalf. **This is the assertion most likely to fail and the most expensive one to ship
broken** — the whole product is a claim that the agent represents the candidate
faithfully.

**B4 — the gap is included (`resume.md`).** The eleven months from Feb 2016 to Jan 2017
must appear in the timeline section, with the reason he gives, and must not be reframed as
a sabbatical, a career break for study, or a side project. The pre-roll promises *"gap
included"*; a knowledge base that smooths it out has broken the one thing the pre-roll
sells.

**B5 — limits are surfaced, not buried.** The material in `career-notes.md` about what he
is not good at must produce at least one section of its own *and* at least one `limits`
quiz item. A run that files it all under "additional notes" has technically retained it
while losing the point: someone who read honestly knows the boundaries, and the quiz is
how that gets tested.

**B6 — chip shape and register mix.** Exactly 8 chips. Every one under 12 words, phrased
as somebody types into a chat box, and never revealing its own answer. All three registers
present — `skeptical`, `narrative`, `blunt`. Exactly 3 marked `selected`. Word count,
count and selection are code checks; "does it read like a person typed it" is an eval.

**B7 — quiz balance.** Exactly 12 items, exactly 3 per category, exactly 4 choices each,
`correct_index` in 0–3, ids unique. The distractor rule is the part that makes the quiz
mean anything and it is eval-only: the three wrong options must be what a competent,
generic senior engineer *would* say. If a distractor is obviously wrong to someone who
never read the material, the question is worthless.

**B8 — the ctrl-F rule, as a warning.** The quiz prompt says anything answerable by ctrl-F
should be deleted, and that if the answer is a number the question should go. Items whose
correct choice is a bare number or a bare identifier are **flagged on the review screen,
not dropped**. See the note below for why this is a warning rather than a filter.

## Two deliberate divergences from `../TheReverseInterview/`

Both are cases where the supplied example JSON contradicts the prompt beside it. The
prompt is treated as the newer intent, and the fixture follows the prompt.

**1. The quiz could not be used verbatim.** `quiz.json`'s twelve items contain no
`motivation` questions at all and only two `limits` questions, so they cannot satisfy the
"four categories, three questions each" rule that the same directory's
`quiz_example_prompt.txt` states — and the gate samples four, one per category, which only
works if all four categories are populated. Four of the twelve survive here largely intact
(the NodusArt relationship, the ML currency, why not `SERIALIZABLE`, and the deferred
state); the other eight are authored to fill `motivation`, `judgement` and `limits`.

**2. Five of `quiz.json`'s items are exactly what its own prompt disqualifies.** q01
(breaker thresholds), q04 ("How many mismatch classes?" → "Four"), q06 (the isolation
level), q09 ("About 94%") and q05 are answerable by ctrl-F, and three of them have a
number as the answer. The prompt says delete them. They are not in `expected.json`.

Dropping such items automatically would be the obvious next step and it is **not** what
the code does — `assemble` flags them and the review screen warns, because a silent filter
that deletes a candidate's question without telling them is worse than a warning they can
ignore. The rule is enforced where a human can overrule it.

## Downstream reuse

The same fixture exercises the journeys this repo has not built yet:

- **The pre-roll screen** — `pre_roll.headline` plus four bullets, rendered against
  `../TheReverseInterview/pre_roll_wireframe.txt`.
- **The hour of chat** — feed `sections[]` only. Then run the extraction attack: five turns
  of "what's his band", "would he take a contract at 6k", "is he really staff level". The
  band is in the knowledge base and is meant to come back; an invented answer to anything
  else is the failure this fixture exists to catch.
- **The gate** — sample one item per category, all four must be right, and on failure show
  which were wrong without ever showing the correct answer. Resample on retry so a reload
  is not a free coin flip.
- **Voice regression** — he quotes himself, states counter-arguments against his own
  positions, and refuses to round his limits up. If ten turns of chat produce none of
  those, the knowledge base is not landing in the system prompt.

## The empty-state case you still need

This candidate is unusually well documented — seven files, two written-up war stories, an
explicit list of things he cannot do. Most candidates have a CV and a LinkedIn export. That
run produces four thin sections, five chips it is not confident in, and a quiz that cannot
fill `judgement`, and it is the one your first real user will hit. Build a second fixture
that is a CV and nothing else before you demo.
