# DESIGN.md

**Project:** The Reverse Interview — a candidate's knowledge base, interrogated by a recruiter
**Design language:** `RISO POSTER` — two-ink risograph print, rendered as software
**Platform:** Next.js (App Router) · Tailwind v4 · shadcn/ui · light theme only
**Primary targets:** laptop 1280–1680 · tablet 768–1279 · mobile is a documented fallback, not a design target
**Status:** v1, weekend POC. Written to be read by a coding agent.

---

## 1. Visual Theme & Atmosphere

This product is one person's history and limits, stated plainly and sold by the hour. The interface should feel like **a printed thing made by a person with a point of view** — a risograph gig poster, a zine, a small-press manifesto — not like a hiring platform.

Three commitments drive every rule below:

**Two inks and paper.** The entire system is black, one pink, and white. No gradients, no soft grays, no drop shadows with blur, no glassmorphism, no third hue. When you need a fourth value, you reach for a *pattern* (halftone, hatch, meander), never a new color. This is the constraint that makes it look designed rather than assembled, and it is also why it stays legible: with only two inks, every contrast decision is already solved.

**Everything is inside a frame.** The app is not a page that scrolls into infinity — it is a printed sheet, bordered in 3px black, sitting on a pink surround. That single structural move is the whole identity, and it costs one layout component.

**Loud furniture, disciplined text.** Full poster intensity applies everywhere, including `/learn` — the frame, the meander rail, the ticker, the pink blocks, the heavy caps, the hard borders. The intensity lives in the *chrome*. Inside the reading column, discipline: one measure, one serif, no borders, no caps, no pink. A brutalist poster is loud around the edges and quiet in the body copy; that's why you can actually read one. Do not resolve this by softening the chrome.

**Adjectives that apply:** printed, blunt, high-contrast, editorial, tactile, opinionated, slightly punk.
**Adjectives that do not:** friendly, soft, playful, minimal, corporate, calm, gradient, "clean SaaS."

**Density:** medium. Generous outer margins (the frame needs air to read as a frame), tight internal grouping. Whitespace is structural — it separates blocks — but it is never used to make the page feel airy or premium. Premium here is communicated by weight and ink, not by emptiness.

---

## 2. Color Palette & Roles

Three inks. One escape hatch. Nothing else.

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#000000` | Every border, every piece of body and UI text, primary button fill. The default. |
| `--pink` | `#F2A0E7` | **Surface only.** Fills, highlighter blocks, active states, page surround, ticker text on black. |
| `--paper` | `#FFFFFF` | The sheet. All content sits on this. |
| `--paper-tint` | `#FDF4FB` | Pink at ~6%. Secondary surfaces inside the sheet: the section index, code blocks, table stripes. |
| `--pink-wash` | `#FBE0F6` | Pink at ~20%. Pink-family surfaces that must hold small black text (citation expansions, callouts). |
| `--pink-deep` | `#D466C4` | Pressed/active state of pink surfaces, and pink borders when a border must not be black. Never for text on white. |
| `--ink-muted` | `#5C5C5C` | Secondary text on `--paper` **only**. Timestamps, helper text, placeholder. |
| `--ink-faint` | `#A3A3A3` | Disabled text and decorative rules only. Never carries meaning. |
| `--surround` | `#F2A0E7` | Page background outside the sheet. Same value as `--pink`, separate token so it can change independently. |
| `--alert` | `#CC2318` | **Escape hatch.** Destructive confirmation and hard validation failure. Permitted in exactly two component variants (see §4). Never decorative, never a chart color, never a badge. |

### The one rule that matters

> **Pink is a surface, never an ink.**

`#F2A0E7` on `#FFFFFF` is **1.92:1**. It fails every contrast standard and it will look cheap. Pink text on white is the fastest way to make this system look like a template.

The inverse is fine and is used heavily: `#F2A0E7` on `#000000` is **10.96:1** — pink caps on a black ticker bar is a signature move.

### Measured contrast (WCAG 2.1)

| Foreground | Background | Ratio | Verdict |
|---|---|---|---|
| `--ink` | `--paper` | 21.0 | Pass AAA |
| `--ink` | `--pink` | **10.96** | Pass AAA — the default pairing on pink |
| `--ink` | `--pink-wash` | 17.09 | Pass AAA |
| `--ink` | `--paper-tint` | 19.51 | Pass AAA |
| `--paper` | `--ink` | 21.0 | Pass AAA |
| `--pink` | `--ink` | 10.96 | Pass AAA — pink-on-black is legal |
| `--ink-muted` | `--paper` | 6.69 | Pass AA all sizes |
| `--ink-muted` | `--pink` | 3.49 | **Fail.** Muted ink is forbidden on pink surfaces — use `--ink`. |
| `--pink` | `--paper` | 1.92 | **Fail.** Never text. Surface only. |
| `--pink-deep` | `--paper` | 3.23 | UI boundaries only (passes 3:1 for non-text). Never text. |
| `--ink-faint` | `--paper` | 2.52 | Disabled only (exempt). |
| `--alert` | `--paper` | 5.50 | Pass AA |
| `--paper` | `--alert` | 5.50 | Pass AA |

### State without hue

There is no green and no amber. State is carried by **fill, weight, and pattern**:

| State | Treatment |
|---|---|
| Success / passed / complete | Solid `--ink` fill, `--paper` glyph (✓). Confident, finished. |
| Active / current / selected | Solid `--pink` fill, `--ink` border, `--ink` text. |
| Locked / unavailable | `--paper` fill, `--ink-faint` 2px border, halftone pattern overlay. |
| Draft / unpublished | Hatch pattern strip across the container's top edge. |
| Warning / thin result | 3px `--ink` border + hatch-filled left gutter, black text. No color change. |
| Destructive / invalid | `--alert` — border and text only, never a large fill except on the confirm button. |

Never encode state in hue alone: `--pink` also always changes the *shape* (outline circle → filled circle) so the section index is readable to a colorblind user and in a black-and-white screenshot.

```css
:root {
  --ink:        #000000;
  --ink-muted:  #5C5C5C;
  --ink-faint:  #A3A3A3;
  --pink:       #F2A0E7;
  --pink-deep:  #D466C4;
  --pink-wash:  #FBE0F6;
  --paper:      #FFFFFF;
  --paper-tint: #FDF4FB;
  --surround:   #F2A0E7;
  --alert:      #CC2318;
}
```

---

## 3. Typography Rules

Three families, each with a job. The split is semantic, not decorative — **the candidate's words are set in serif; the application's own voice is set in grotesk.** A recruiter reading a section should be able to tell, without reading, which sentences they paid for.

| Family | Source | Used for |
|---|---|---|
| **Archivo** (variable, `wght` 400–900, `wdth` 62–125) | Google Fonts | Display, headings, all UI chrome, buttons, nav, the recruiter's own chat turns |
| **Newsreader** (variable, `opsz` 6–72) | Google Fonts | Section bodies, the candidate's chat turns, chip `why_it_lands`, quiz rationales |
| **DM Mono** (400, 500) | Google Fonts | Section ordinals, the hour's timer and cost meter, turn counters, section ids, timestamps |

### Scale

| Token | Size / Line | Family & treatment | Used for |
|---|---|---|---|
| `display-xl` | 64 / 60 | Archivo 800, `wdth` 110, `-0.02em`, **UPPERCASE** | Marketing hero only. Max 4 words per line. |
| `display-l` | 44 / 44 | Archivo 800, `-0.02em`, **UPPERCASE** | Page titles, pre-roll headline |
| `display-m` | 32 / 34 | Archivo 800, `-0.01em`, **UPPERCASE** | Section heads, the candidate's name on `/k/:slug` |
| `title` | 22 / 28 | Archivo 700, sentence case | Card titles, section titles, chip text, dialog headers |
| `body-l` | 19 / 32 | Newsreader 400 | **Section body, candidate chat turns.** The reading size. |
| `body` | 16 / 26 | Archivo 400 | UI copy, forms, recruiter chat turns |
| `body-s` | 14 / 22 | Archivo 400 | Helper text, secondary card copy |
| `label` | 13 / 16 | Archivo 600, `+0.08em`, **UPPERCASE** | Buttons, tabs, nav, chips, table headers |
| `meta` | 12 / 16 | DM Mono 400, `+0.06em`, **UPPERCASE** | `SECTION III`, `42:10 LEFT`, `$3.40 SO FAR`, section ids |

### Hard rules

- **Uppercase is for ≤ 8 words.** Headlines, labels, buttons, ticker. Never a sentence, never body copy, never a section title longer than a phrase. All-caps destroys word-shape recognition; it is a poster device, not a text device.
- **Measure is capped at 68ch** for `body-l` and 72ch for `body`. In `/learn`, the thread column is `max-width: 68ch` regardless of viewport. Wide reading columns are the single most common way a brutalist layout becomes unreadable.
- **Only one `display-xl` per page.** Ever.
- Never letter-space lowercase text. Positive tracking is for caps only.
- Never set Newsreader in caps. Never set Archivo 800 at body sizes.
- Numerals: DM Mono is tabular by default — use it anywhere numbers change in place (the timer, the cost meter), so nothing shifts.

```ts
// app/fonts.ts
import { Archivo, Newsreader, DM_Mono } from "next/font/google";

export const archivo = Archivo({
  subsets: ["latin"], axes: ["wdth"], variable: "--font-display", display: "swap",
});
export const newsreader = Newsreader({
  subsets: ["latin"], variable: "--font-serif", display: "swap",
});
export const dmMono = DM_Mono({
  subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap",
});
```

---

## 4. Component Stylings

### 4.0 The primitives

- **Radius:** containers `0`. Actions and chips `999px` (full pill). Avatars `50%`. There is no `8px` in this system. The square-container / pill-action contrast is a signature — do not blur it.
- **Borders:** `--bd-hair: 1.5px`, `--bd: 2px`, `--bd-heavy: 3px`. Always `solid`, always `--ink` unless specified.
- **Elevation:** hard offset shadow, zero blur. `--lift: 4px 4px 0 0 var(--ink)`, `--lift-lg: 8px 8px 0 0 var(--ink)`. There are no blurred shadows in this system.

### 4.1 Button

Pill, 2px black border, bold uppercase `label`. Hover lifts the button up-left and reveals the hard shadow; press slams it back down. No fades — the transition is `transform 90ms steps(3)`.

| Variant | Rest | Hover | Active | Disabled |
|---|---|---|---|---|
| `primary` | fill `--ink`, text `--paper`, border `--ink` | `translate(-2px,-2px)` + `--lift` | `translate(0,0)`, no shadow | fill `--paper`, text/border `--ink-faint`, no lift |
| `accent` | fill `--pink`, text `--ink`, border `--ink` | `translate(-2px,-2px)` + `--lift` | fill `--pink-deep`, `translate(0,0)` | as above |
| `secondary` | fill `--paper`, text/border `--ink` | fill `--pink` | fill `--pink-deep` | as above |
| `ghost` | no fill, no border, text `--ink`, underline on hover | pink highlighter block behind text | — | text `--ink-faint` |
| `destructive` | fill `--paper`, text/border `--alert` | fill `--alert`, text `--paper` | — | as above |

Sizes: `sm` 34px (`label` 12px, pad 0 16), `md` 44px (pad 0 24) — **the default, and the tablet touch-target floor** — `lg` 56px (`label` 15px, pad 0 36).

Icon-only buttons are circles, never pills, and never below 44px.

### 4.2 Card / Sheet

Square. `--bd` 2px black on `--paper`. No shadow at rest. A card that is *pickable* (a chip card, a section row) gets `--lift` on hover plus `translate(-3px,-3px)`; a card that is merely a container never lifts.

### 4.3 Chip card — the review screen's Questions tab

Eight of these are generated and the candidate picks three. The card is where that
choice is made, so selection has to be legible at a glance and in greyscale: a chosen
chip is filled `--pink` **and** carries a solid-ink `✓ ON YOUR FRONT PAGE` tag. Fill
alone would fail a black-and-white screenshot; the tag alone would be quiet.

```
┌──────────────────────────────────────────┐  3px border, --pink fill when chosen
│  QUESTION 3          ✓ ON YOUR FRONT PAGE│  meta label · solid ink tag
│                                          │
│  WHAT THEY TYPE ───────────────────────  │  meta label
│  ┌────────────────────────────────────┐  │  title 22px, --paper field
│  │ why did he leave agoda?            │  │
│  └────────────────────────────────────┘  │
│                                          │
│  REGISTER ─────────────────────────────  │  three pills; chosen one is ink-filled
│  ( Skeptical )( Narrative )[ Blunt ]     │
│                                          │
│  WHY THIS ONE ─────────────────────────  │  body-l Newsreader italic
│  Blunt, and every recruiter asks it      │  the candidate's private note
│  eventually. One paragraph, no wandering.│
│                                          │
│  ANSWERS FROM ─────────────────────────  │  meta label
│  career/timeline#agoda-exit              │  DM Mono 13px
│                                          │
│  [ SELECTED ] [ MAKE IT BLUNT ] [ DELETE]│  sm buttons
└──────────────────────────────────────────┘
```

Grid: 2-up at ≥1280, 1-up below. Gap 24px.

**The public form** is text only, on a pink pill, exactly as a recruiter taps it — and
there is nothing to reveal, because `why_it_lands` and `kb_section` never reached the
browser.


### 4.4 Avatar — duotone treatment (mandatory)

Candidates upload arbitrary photographs. An unprocessed photo destroys a two-ink system instantly. Every avatar and hero portrait is duotoned to black + pink in CSS:

```css
.riso-portrait {
  position: relative; border-radius: 50%; overflow: hidden;
  border: 3px solid var(--ink); background: var(--pink);
}
.riso-portrait img {
  filter: grayscale(1) contrast(1.45) brightness(1.05);
  mix-blend-mode: multiply;   /* photo darks → black, lights → pink */
  width: 100%; height: 100%; object-fit: cover;
}
```

### 4.5 The pre-roll card — the paid moment

`TheReverseInterview/pre_roll_wireframe.txt`, built. This is the last thing a recruiter
reads before money moves, so it gets the most care.

```
┌─ 3px black ─────────────────────────────────────┐
│  SIXTY MINUTES. STARTS WHEN YOU HIT SEND.       │  display-m caps
│                                                 │
│  WHAT'S LOADED ───────────────────────────────  │  meta label
│   ▸ Full timeline, four employers, gap included │  body-l Newsreader
│   ▸ 6 systems I built, at architecture depth    │
│   ▸ Bring your band, it'll say if it clears     │
│   ▸ Opinions I'll defend and can't be talked    │
│     out of                                      │
│                                                 │
│  ─────────────────────────────────────────────  │  2px rule
│  $3.00 + MODEL COST. METER VISIBLE THROUGHOUT.  │  meta
│                                                 │
│        [ START MY HOUR ]                        │  lg primary
└─────────────────────────────────────────────────┘
```

Exactly four bullets. A fifth is not a design problem to solve — it is dropped on save,
and the editor renders the card live beside the textarea so that is visible rather than
surprising.

> ⚠️ **Engineering, not styling:** `GET /api/kb/:id?audience=public` must omit the whole
> quiz, plus `why_it_lands`, section bodies and `source_text`. This is stronger than the
> usual withholding argument: the quiz is the gate before a recruiter books twenty real
> minutes, so a `correct_index` in a devtools panel does not leak a teaser — it hands
> over the answer key.


### 4.6 Chat thread — asymmetric by design

**Do not use symmetric left/right bubbles.** The candidate's agent is answering; the recruiter is interrogating. The geometry should say so.

```
  ┌ ARUN ──────────────────────────────────────┐   Agent turn:
  │ (◉)  Five and a half years on supplier      │   NO border, NO fill.
  │      payouts. The interesting part was      │   Newsreader body-l 19/32,
  │      never throughput — it was paying       │   full 68ch column,
  │      twice.                                 │   name in meta caps above,
  │                                             │   32px avatar at left gutter.
  │      ▸ AGODA/SUPPLIER-PAYOUTS               │
  └─────────────────────────────────────────────┘

                        ┌──────────────────────┐   Recruiter turn:
                        │ does he have card    │   2px black border, square,
                        │ issuing experience?  │   --paper-tint fill,
                        └──────────────────────┘   Archivo body 16/26,
                                                   max 44ch, right-aligned,
                                                   no avatar, no name.
```

The candidate's words get the page. The recruiter's get a box. Turn spacing: 32px between speakers, 12px within a speaker's consecutive turns.

**Streaming cursor:** a solid pink block, blinking in steps — not a fading dot triad.

```css
.stream-caret {
  display:inline-block; width:.55em; height:1.05em; background:var(--pink);
  vertical-align:-.15em; animation: caret 1s steps(2,start) infinite;
}
@keyframes caret { 50% { opacity: 0 } }
```

### 4.7 Citation chip

`▸ AGODA/PSP-ROUTING#CIRCUIT-BREAKERS` — pill, 1.5px black border, `meta` type in DM
Mono, `--paper` fill. Hover: `--pink` fill. Click: expands *inline beneath the turn* into
a bordered quote block, `--pink-wash` fill, 3px black left rule, Newsreader italic, with
a `meta` caption naming the section. Expansion is instant — no height animation.

The chip carries a section **id**, not a title, and that is deliberate on both sides: the
recruiter can see the agent is citing something specific rather than gesturing, and the
candidate reviewing their own knowledge base sees the exact string every chip and quiz
item resolves against.


### 4.8 Section index — the roman numeral rail

Lifted directly from the reference: `I II III IV` in outlined circles down a rail. What
used to be a syllabus is the index of the knowledge base — what's loaded, in the order a
stranger should read it.

| State | Circle | Label |
|---|---|---|
| `cited` — something references this section | 28px, fill `--ink`, `--paper` numeral | Archivo 700, `--ink` |
| default | 28px, `--paper` fill, 2px `--ink` border, numeral in `--ink` | Archivo 400, `--ink` |

Rail background `--paper-tint`, separated from the content by a 3px black rule. Width
280px fixed. Labels are 15px/1.4 (not `body`) — at 280px with a 28px numeral and 20px
padding, 16px wraps three-line titles badly. Numerals are DM Mono 500 at **10px**, not
12px: `VII` at `meta` size overflows a 28px circle.

Filled versus outlined is a real distinction, not decoration: an uncited section is one
no opening question and no quiz item points at, which is worth seeing before you publish.
It survives greyscale, which the pink highlighter behind a label would not — that also
breaks across wrapped lines and looks like a rendering fault.


### 4.9 The hour meter — discrete blocks, not a bar

Journey 2. Specified here because it is the one place a number moves while somebody
watches, and getting it wrong is expensive.

```
SIXTY MINUTES                     42:10 · $3.40
┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐
│▓▓▓│▓▓▓│▓▓▓│▓▓▓│   │   │   │   │   │   │   │   │   12 blocks = 5 minutes each
└───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘
```

2px black track, one cell per five minutes, filled `--pink`, each snapping in over
`140ms steps(1)`. A discrete snap reads as time *spent*; a smooth fill reads as loading,
and this is the one component where the difference is money. The clock and the running
cost are DM Mono so nothing shifts as they tick.


### 4.10 Input / Textarea / Select

Square, 2px `--ink` border, `--paper` fill, 12px 16px padding, Archivo `body`. Placeholder `--ink-muted`.
**Focus:** `outline: 3px solid var(--ink); outline-offset: 3px;` — a black ring with a paper gap. No pink glow, no border-color change. This ring is legible on both white and pink surfaces, which is why it's black rather than pink.
**Invalid:** border → `--alert`, plus a hatch-filled 4px strip on the left edge, plus a `body-s` message in `--alert`. Three signals, one of them non-chromatic.

The chat composer is the exception: 3px border, 56px min height, auto-grows to 6 lines, with `[SKIP AHEAD]` and `[I'M LOST]` as `sm` secondary buttons pinned to its right edge.

### 4.11 Tabs — file folder

For `/studio/:id` (Questions · Knowledge base · Quiz · Pre-roll). Square-topped tabs
sitting on a 3px rule. Active tab: `--ink` fill, `--paper` label, and the rule beneath it
is erased so the tab reads as connected to the panel. Inactive: `--paper` fill, `--ink`
border, `--ink-muted` label.

Each tab carries a count, and the first one carries a ratio — `QUESTIONS · 2/3` — because
publishing needs exactly three chosen and the tab bar is where that is legible without
opening the tab.


### 4.12 The gate card — `/gate/:id`

Journey 3. Not a chat bubble: it interrupts as a black block, because it is the moment
the product says no.

```
████████████████████████████████████████████
█  ✕✕  ONE WRONG  ✕✕                       █   --pink caps on --ink,
█                                          █   ticker treatment
█  Two of these four were right. We're     █   Newsreader, --paper
█  not saying which — go back and read      █
█  the sections on limits, then try again. █
█                                          █
█  ┌──────────────────────┐                █
█  │  FOUR NEW QUESTIONS  │  accent button █
█  └──────────────────────┘                █
████████████████████████████████████████████
```

Two rules the copy has to carry, and both are load-bearing: **never show which answer was
correct**, and **resample on retry**, so a reload is not a free second attempt at the same
four questions. Unlimited retries — the gate is a reading check, not a punishment.


### 4.13 Ticker strip

Black bar, 44px, `--pink` `label` caps, `✕✕` separators, scrolling `translateX` at ~40s/loop. Two uses only: the app frame's bottom edge, and the hour's remaining time (`✕✕ 42 MINUTES LEFT ✕✕`). `prefers-reduced-motion` → static, no scroll.

### 4.14 Empty & loading states

No spinners, no skeleton shimmer. A loading region is filled with the **halftone pattern**; a completed region replaces it with content. Ingestion (60–120s) shows a bordered panel with halftone fill, a `meta` line of streamed status (`WRITING SECTION 4 OF 14 · PSP ROUTING`), and no progress percentage you can't honour. The status lines are honest because each one is a real activity finishing, not a timer.

Empty states are a bordered box on halftone with one `title` line and one action. Copy is blunt, never apologetic: *"Nothing here yet. Build one."*

> **Never set text directly on halftone.** The dots sit at 30% black and destroy small type. Halftone is always a *ground*; the words go in a `--paper` box with a 2px border floating on top of it. This applies to the dropzone, empty states, and the ingestion panel alike.

---

## 5. Layout Principles

### 5.1 The frame — build this first

Every screen is a **sheet on a surround**. This is the app shell and it is the highest-leverage component in the system.

```
  ░░░░░░░░░░░░░░ --surround (pink) ░░░░░░░░░░░░░░
  ░ ╔══════════ meander pattern rail, 28px ═══╗ ░
  ░ ║ ● ● ●          NAV          [SIGN IN AS]║ ░   3px black border
  ░ ╠══════════════════════════════════════════╣ ░
  ░ ║                                          ║ ░
  ░ ║          --paper · screen content        ║ ░
  ░ ║                                          ║ ░
  ░ ╠══════════════════════════════════════════╣ ░
  ░ ║ ✕✕ KNOWLEDGE FROM PEOPLE WHO ARGUE ✕✕   ║ ░   ticker, black
  ░ ╚══════════════════════════════════════════╝ ░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

- Surround margin: 32px at ≥1280, 16px at 768–1279, 0 at <768 (frame border drops to `--bd` 2px, meander rail hides).
- Sheet `max-width: 1440px`, centred. Content `max-width: 1200px` inside it.
- The sheet scrolls internally on `/learn` and `/studio/:id` so the frame stays fixed. Everywhere else the whole sheet scrolls.

### 5.2 Spacing scale

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128`. Nothing between. Section rhythm on marketing screens is 96; on working screens (`/learn`, `/studio`) it's 32.

### 5.3 Grid

12 columns, 24px gutter, inside the 1200px content width. Standard splits:

| Screen | Split |
|---|---|
| `/k/:slug` | pre-roll card 7/5 (card / portrait) · 3 chips below, centred |
| `/hour/:id` | section index 280px fixed + thread fluid, meter pinned to the rail's foot |
| `/gate/:id` | single 6-col column, centred. One question at a time. |
| `/studio/:id` | tab bar 12 · panel 8/4 (editor / live public preview) |
| `/studio/new` | single 8-col column, centred |

### 5.4 Whitespace

Structural, not decorative. Two blocks that belong together sit 12–16px apart with no rule; two that don't sit 48px apart *with* a 3px rule or a meander divider. Never rely on distance alone to separate — this system separates with ink.

---

## 6. Depth & Elevation

There are **four planes** and no blur anywhere.

| Plane | Treatment | Used for |
|---|---|---|
| 0 · Surround | `--surround` flat pink | Outside the sheet |
| 1 · Sheet | `--paper`, 3px `--ink` border | The app |
| 2 · Raised | `--paper`, 2px border, `--lift` (`4px 4px 0 --ink`) | Hovered cards, dropdowns, popovers, chips in an active state |
| 3 · Overlay | `--paper`, 3px border, `--lift-lg` (`8px 8px 0 --ink`) | Dialogs, the ingestion panel, the gate card. Backdrop is `--pink` at 92% opacity — **not** black at 50%. A pink scrim keeps the print language; a black scrim looks like every other web app. |

Rules: elevation is never animated in blur or opacity, only in `transform` + shadow presence. Nothing has more than one shadow. Nested elevation is forbidden — a raised card inside a dialog is flat.

---

## 7. Do's and Don'ts

**Do**

- Reach for a pattern when you want a third value: `halftone` for absent/locked/loading, `hatch` for invalid/disabled/draft, `meander` for a divider that needs ceremony.
- Put black on pink. It's the strongest, most on-brand pairing you have (10.96:1).
- Use the pink highlighter span for emphasis inside a heading — that inline pink block behind display text is the reference image's most recognisable gesture.
- Let buttons move. The lift-and-slam is the only tactility in a flat system.
- Cap every reading column at 68ch.
- Keep copy blunt and short. Long strings break caps layouts and this design has no room for marketing prose.

**Don't**

- ❌ Pink text on white. Ever. (1.92:1)
- ❌ Blurred shadows, gradients, glass, glow, or any `border-radius` between `1px` and `998px` on a container.
- ❌ A third hue. Not for charts, not for tags, not for "just this one badge." Use patterns and fills.
- ❌ Uppercase body copy or uppercase anything over 8 words.
- ❌ Symmetric chat bubbles. The asymmetry in §4.6 is load-bearing.
- ❌ CSS-blurring withheld content instead of omitting it server-side. The quiz especially: a `correct_index` in a devtools panel is the answer key to the booking gate.
- ❌ Easing curves. Motion in this system is stepped (see §9). No `cubic-bezier` smoothness.
- ❌ Emoji as UI iconography. Use text glyphs (`✓ ▸ ✕ ●`) or a single stroke-only icon set (Lucide at 2px, black).
- ❌ Softening the chrome to make `/learn` more comfortable. Fix comfort in the text column (measure, leading, serif), not by turning the poster down.
- ❌ Placeholder photography that isn't duotoned.

---

## 8. Responsive Behavior

Desktop-first. Baseline 1280.

| Breakpoint | Range | Behaviour |
|---|---|---|
| `lg` (baseline) | ≥1280 | Full spec. 32px surround, 3-up catalog, `/learn` rail visible. |
| `md` (tablet — real target) | 768–1279 | 16px surround. Catalog 2-up. `/studio` preview panel collapses under the editor. `/hour` section index collapses into a sticky top strip: `[ ☰ VII · PSP ROUTING ]` chip + the inline hour meter; tapping opens the full index as a left sheet at plane 3. All touch targets ≥44px — the `md` button size already satisfies this, so *never use `sm` buttons for primary actions on tablet*. `display-xl` steps down to 48/46. |
| `sm` (fallback, not designed) | <768 | Surround → 0, frame border → 2px, meander rail hidden, ticker hidden. Single column throughout. Catalog 1-up. `/hour` is thread-only with the index behind the ☰ chip. `display-l` → 32/34. Ship it working, not polished. |

Touch: hover-only affordances must have a non-hover equivalent. The card lift is decorative (fine); the citation chip's hover fill is not the only signal (the ▸ glyph rotates to ▾ on expand), and a selected chip carries a tag as well as a fill.

---

## 9. Motion

Print doesn't ease. Everything in this system moves in **steps**.

| Motion | Spec |
|---|---|
| Button hover/press | `transform 90ms steps(3)` |
| Card lift | `transform 120ms steps(3)`, shadow toggles with no transition |
| Hour-meter block fill | `140ms steps(1)` — a snap, one block at a time |
| Streaming caret | `1s steps(2, start)` infinite |
| Ticker scroll | `translateX` linear, ~40s/loop |
| Tab / panel switch | none. Instant. |
| Dialog enter | `transform: translate(8px,8px) → 0` over `120ms steps(3)`, opacity untouched |

No fades. No spring. No `ease-in-out`. Under `prefers-reduced-motion: reduce`, the ticker stops scrolling, the caret stops blinking (stays solid), and progress blocks fill instantly.

---

## 10. Patterns — copy these verbatim

The four patterns are the identity. Without them this is generic neo-brutalism.

```css
/* Halftone — absent, locked, loading */
.pat-halftone {
  background-image: radial-gradient(rgba(0,0,0,.30) 1px, transparent 1.3px);
  background-size: 6px 6px;
}

/* Hatch — invalid, disabled, draft */
.pat-hatch {
  background-image: repeating-linear-gradient(
    45deg, var(--ink) 0 2px, transparent 2px 8px);
}

/* Greek meander — the frame's top rail, ceremonial dividers */
.pat-meander {
  height: 28px;
  background-repeat: repeat-x;
  background-size: 24px 24px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M2 22V6h16v12H8v-8h6' fill='none' stroke='%23000' stroke-width='2'/%3E%3C/svg%3E");
}

/* Pink highlighter — emphasis inside display type */
.hl {
  background: var(--pink);
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  padding: 0 .18em;
}
```

---

## 11. Screens

Journey 1 builds the candidate's four. The rest are specified so the language does not
have to be reinvented when they land.

### `/studio` — the candidate's list
Frame → `SectionHead` with the signed-in name and a count → a table, not cards (2px
rules, `label` caps headers, `--paper-tint` zebra). Draft rows carry the hatch gutter
from §2. Columns: name, sections, questions, quiz, status. One `lg accent` button:
`BUILD ONE`. Empty state: *"Nothing here yet. Build one."*

### `/studio/new` — upload
Dropzone: 3px **dashed** black border (the only dashed border in the system), halftone
fill, 240px tall, `title` copy *"Drop your documents here."* Then two inputs: your name,
one line. **No price** — pricing is fixed at the platform level, so it is copy on the
pre-roll rather than a field. One `lg primary` `BUILD MY KNOWLEDGE BASE`. Ingestion
replaces the panel with the halftone loading state (§4.14).

### `/studio/:id` — review
Tabs (§4.11), **default to Questions**. That default is the reframe: eight openers were
generated and the candidate is choosing which three represent them.

- **Questions · n/3** — chip cards (§4.3), 2-up, with the selection counter above the
  grid as a bordered strip that fills `--pink` at exactly three. A dashed-border
  `+ ADD A QUESTION` card ends the grid.
- **Knowledge base · N** — reorderable section list, inline-edit title and summary,
  collapsible body, and the section **id** editable in DM Mono. The id is not hidden:
  renaming a section is how a candidate orphans three questions, and the warning that
  follows makes more sense next to the field that caused it.
- **Quiz · 12** — grouped under the four categories the gate samples from, each with an
  `n / 3` counter. Four options per item, one radio-marked correct and filled `--pink`.
- **Pre-roll** — headline and four bullets on the left, the §4.5 card rendered live on
  the right.

Right-hand 4-col panel: the public projection, re-fetched through `?audience=public`
rather than rendered from memory, so it *proves* the withholding rule instead of
imitating it.

### `/studio/:id/preview`
The recruiter's landing view — the pre-roll card, the three chosen questions, the section
index — rendered inside a 3px bordered inset with a ticker strip pinned to its top:
`✕✕ PREVIEW — NOT LIVE ✕✕`. `START MY HOUR` is present and disabled.

### `/k/:slug` — the public page  *(Journey 2)*
Hero 7/5: duotoned portrait (§4.4) at ~380px on a pink block, name in `display-m`, the
one-liner in `body-l`. Then the pre-roll card (§4.5), then the three chips as tappable
pills. Section titles listed below, summaries only. `[ START MY HOUR ]` opens LinkedIn
signup; approval is an email round trip, so the next screen a recruiter sees is a waiting
state, and it should say so plainly rather than spin.

### `/hour/:id` — the hour  *(Journey 2)*
280px section index (§4.8) + thread (§4.6). The hour meter (§4.9) is pinned to the rail's
foot and is visible throughout — it is the thing the recruiter is paying for and hiding it
would be dishonest. Thread header: duotoned 32px avatar, `ARUN · 42 MINUTES LEFT` in
`meta`. Composer at §4.10, with `[SUMMARISE & DOWNLOAD]` as an `sm` secondary button.

### `/gate/:id` — four questions  *(Journey 3)*
6 cols centred, one question at a time, four options as full-width bordered rows. On
failure, the §4.12 card. Never reveal which answer was right; resample on retry.

### `/book/:id` — twenty minutes  *(Journey 3)*
6 cols centred. Calendar, then an order summary in `meta`, then `lg primary`
`REQUEST 20 MINUTES — $20`. The candidate approves by email, so this ends in a waiting
state too.


## 12. Implementation Notes (Next.js + Tailwind v4 + shadcn/ui)

```
app/
  layout.tsx          ← fonts + <AppFrame>
  globals.css         ← @theme tokens, patterns, base
  page.tsx            ← / (redirects to /studio until Journey 2 lands)
  studio/page.tsx  studio/new/page.tsx  studio/[id]/page.tsx  studio/[id]/preview
  k/[slug]/page.tsx   ← Journey 2
  hour/[id]  gate/[id]  book/[id]   ← Journeys 2 and 3
components/
  frame/AppFrame.tsx  ← BUILD THIS FIRST. Surround + sheet + meander rail + ticker.
  frame/Ticker.tsx  frame/RoleSwitcher.tsx
  ui/                 ← shadcn, retheme'd
  kb/ChipCard.tsx  kb/RisoPortrait.tsx
  interview/PreRollCard.tsx  interview/SectionIndex.tsx  interview/RecruiterPreview.tsx
  studio/ChipsTab  SectionsTab  QuizTab  PreRollTab  PublicPreviewPanel  KBTable
  chat/Thread.tsx  AgentTurn.tsx  RecruiterTurn.tsx  CitationChip.tsx  Composer.tsx
                      ← Journey 2; not built
```

```css
/* globals.css */
@import "tailwindcss";

@theme {
  --color-ink: #000000;
  --color-ink-muted: #5C5C5C;
  --color-ink-faint: #A3A3A3;
  --color-pink: #F2A0E7;
  --color-pink-deep: #D466C4;
  --color-pink-wash: #FBE0F6;
  --color-paper: #FFFFFF;
  --color-paper-tint: #FDF4FB;
  --color-alert: #CC2318;

  --font-display: var(--font-archivo);
  --font-serif: var(--font-newsreader);
  --font-mono: var(--font-dm-mono);

  --radius-none: 0px;
  --radius-pill: 999px;

  --shadow-lift: 4px 4px 0 0 #000;
  --shadow-lift-lg: 8px 8px 0 0 #000;
}
```

**shadcn components to install:** `button dialog tabs scroll-area textarea input avatar tooltip separator dropdown-menu`. Retheme by editing the copied files, not by wrapping them.
Two global overrides to apply immediately after `npx shadcn init`, because its defaults fight this system: set every `rounded-md` to `rounded-none` (except Button → `rounded-full`), and delete every `shadow-sm`/`shadow-md` in favour of `shadow-lift`.

**Build order:**
1. `AppFrame` + tokens + fonts. Half an hour, and every subsequent screen inherits the look for free.
2. `ChipCard` — the review screen's Questions tab is where a candidate spends their time, and the card is reused verbatim on `/k/:slug` in its public form.
3. `PreRollCard` + `SectionIndex` — the two components `/studio/:id/preview` and `/k/:slug` share.
4. `SectionsTab`, `QuizTab`, `PublicPreviewPanel` — the rest of the review screen.
5. `KBTable`, the dropzone, ticker polish.
6. *Journey 2:* `Thread` + `AgentTurn` / `RecruiterTurn` + `Composer` + the hour meter.

**Accessibility checklist before demo:** black 3px focus ring visible on every interactive element (never `outline: none`); section-index states distinguishable in greyscale; `aria-live="polite"` on the streaming turn; `prefers-reduced-motion` honoured on ticker, caret, and the hour meter; the selected-chip state readable without colour; every duotoned portrait has real `alt` text.

---

## 13. Agent Prompt Guide

**Quick reference:** ink `#000000` · pink `#F2A0E7` (surface only) · paper `#FFFFFF` · tint `#FDF4FB` · wash `#FBE0F6` · muted `#5C5C5C` · alert `#CC2318`. Archivo (display/UI) · Newsreader (knowledge) · DM Mono (numbers). Containers `radius: 0`, actions `radius: 999px`. Borders 2px/3px black. Shadows hard-offset, zero blur. Motion in `steps()`.

**Prompt — a new screen**

> Build `<screen>` following DESIGN.md. Wrap it in `<AppFrame>`. Two inks only: black `#000000` and pink `#F2A0E7` on white — pink is a surface, never text. Square containers with 2–3px black borders, pill buttons, hard offset shadows (`4px 4px 0 #000`) with zero blur. Archivo 800 uppercase for headings (≤8 words), Newsreader 19/32 for any content the candidate "said", DM Mono uppercase for numbers. Use the halftone pattern for anything absent, locked, or loading — never a spinner or skeleton shimmer. Transitions use `steps()`, never easing. Cap reading columns at 68ch.

**Prompt — a new component**

> Add `<component>` in the RISO POSTER language from DESIGN.md: `border: 2px solid #000`, `border-radius: 0`, white fill, no shadow at rest; if it's clickable add `transform: translate(-3px,-3px)` + `box-shadow: 4px 4px 0 #000` on hover over `120ms steps(3)`. Labels are Archivo 600 uppercase 13px with `+0.08em` tracking. Any state colour comes from fill and pattern, not hue.

**Prompt — reviewing generated UI**

> Check this against DESIGN.md and list violations: pink used as text on white; any border-radius between 1px and 998px on a container; blurred shadows or gradients; a third hue; uppercase runs over 8 words; reading columns over 68ch; eased transitions; spinners or shimmer skeletons; symmetric chat bubbles; withheld content rendered then CSS-blurred; state carried by fill alone with no second signal.
