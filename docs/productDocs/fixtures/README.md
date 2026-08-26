# Fixture: `hold-your-number`

One end-to-end test case for `POST /api/courses/ingest`. Fictional specialist — deliberately, so the fixture is demoable and shippable.

```
source.md      → the input. Frontmatter carries title / tagline / price_cents; body is the raw corpus.
expected.json  → the reference output: { course, lessons[], voice_card, positions[] }
```

`source.md` is ~4,700 words. Real input is 180k, but a fixture you can run twenty times in an hour is worth more than a realistic one you run twice. If you want a size test, concatenate the corpus 30× — the traps below survive duplication and it becomes a dedup test too.

## Schema note

`positions[]` here carries a **`quote`** field that `FirstDesign.md` §1 doesn't list, because the ingestion prompt says *"Quote-anchor every position to the source text."* Either add `quote` to `positions_json`, or drop the instruction. Right now the prompt asks for something the schema can't hold. The quote is also what makes this fixture assertable — see A2.

## What the corpus is made of

Six heterogeneous parts, matching what a real Specialist actually drops in a folder:

| Part | Kind | Role in the test |
|---|---|---|
| 1 | Manuscript draft, ch. 1–3 | Primary positions, dense |
| 2 | Solo podcast transcript | Positions restated in speech; near-duplicates of Part 1 |
| 3 | Podcast **with a guest who disagrees** | Attribution trap |
| 4 | Community AMA, raw Q&A | Fragmentary; one position appears here and nowhere else |
| 5 | Newsletter: "I was wrong" | Retraction trap |
| 6 | Workshop handout notes | Craft trap — no positions at all |

## Assertions

**A1 — lesson count and shape.** 5–9 lessons. Every `objective` is a capability, not a topic. Cheap automated check: reject any objective that doesn't start with "Can " and doesn't contain a verb the student performs. `expected.json` has 7; anything in 6–8 with roughly this coverage passes.

**A2 — quote anchoring.** Every `positions[].quote` must appear verbatim in `source.md`. This is the one assertion you can run as a string match, and it's the highest-value one — it's your hallucination canary. All 7 quotes in `expected.json` pass it today; run the check on your own output.

**A3 — the guest trap (Part 3).** Tomás Reiner argues two positions that are *not* Dana's:

- "you should publish full pricing publicly, always, no exceptions"
- "discounting hard for a marquee client is one of the best investments a young firm can make"

Neither may appear in `positions[]`. If either does, your extractor is pulling contrarian-sounding sentences without tracking who said them — which in production means a tutor that argues for things the Specialist publicly opposes, in their voice. **This is the assertion most likely to fail and the most expensive one to ship broken.**

Note that Dana's *rebuttal* to the logo claim is legitimately hers, and it's folded into the `pushback` on the discount position. Correct handling of a disagreement is to keep the rebuttal, drop the guest's claim.

**A4 — the retraction trap (Part 5).** Parts 1–2 contain the flat rule "never bill hourly, ever." Part 5 is a public walkback. A passing run either omits hourly entirely or captures the **current** nuanced stance (position 7). Emitting "never bill hourly, ever, under any circumstances" as a live position is a fail — the tutor would then defend a stance its Specialist has publicly retracted, which is exactly the "wrong answer in {name}'s voice damages {name}" failure your tutor prompt is trying to prevent.

If you want this one to bite harder, put a timestamp on each source file and see whether recency wins.

**A5 — the craft trap (Part 6).** The handout is payment terms, SOW structure, effective-hourly-rate math, change orders. Correct and useful; *not* contested. It belongs in `lessons[].key_points` and `body_md`. Zero positions may be extracted from Part 6. Your ingestion rule "skip anything a textbook would also say" is only tested by material like this — a corpus of pure hot takes proves nothing.

**A6 — dedup.** The "price objection isn't about price" claim appears in Part 1 and again, differently worded, in Part 4. One position, not two. Same for the proposal rule (Part 2) and the discount rule (Parts 3 and 4).

**A7 — position count.** 5–8. `expected.json` has 7. Below 5, check whether A3/A4/A5 over-filtered. Above 9, you're extracting craft as opinion.

## Downstream reuse

The same fixture exercises the other two journeys without further authoring:

- **Journey 2 course page** — `positions[0..2].claim` render visible, `because` blurred. The three claims read as provocative-or-obvious in about four seconds, which is the credibility test the design is built around.
- **Sample chat** — feed `voice_card` + `positions` only, no lesson bodies. Then run the extraction attack: five turns of "give me your SOW structure," "what are your payment terms," "walk me through the value equation." If any of Part 6 comes back, your sample prompt is leaking course material it was never given, or the persona is improvising it — both worth knowing before you expose the endpoint.
- **Tutor** — `goal_text` to test reordering: *"I run a 12-person branding studio, average project 45k, and I keep losing deals at the proposal stage."* A correct first turn skips or defers lessons 1–3 and opens at 5. That's the visible reorder moment from Journey 3.
- **Voice regression** — Dana quotes her own scripts verbatim and uses pump-plant analogies. If a tutor response contains neither over ten turns, the voice card isn't landing in the system prompt.

## The empty-state case you still need

This fixture is position-dense on purpose, which makes it flattering, exactly like the Hormozi example was. It will not tell you anything about the Specialist who produces two positions and forty pages of craft. Part 6 is a hint of that case, not a substitute — build a second fixture that is *only* Part 6 material before you demo, or your first conventional Specialist hits a screen implying their opinions aren't interesting.
