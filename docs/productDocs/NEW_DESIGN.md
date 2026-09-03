# NEW_DESIGN.md

**Project:** The Reverse Interview — the candidate's authoring studio
**Design language:** `WARM DOCUMENT` — cream paper, charcoal type, one orange signal
**Platform:** Next.js (App Router) · Tailwind v4 · shadcn-owned components · light theme only
**Primary target:** laptop 1440–1728 · tablet 1024–1439 · mobile is a documented fallback
**Status:** v1. Written to be read by a coding agent. Replaces `DESIGN.md` (RISO POSTER).

---

## 0. What changed, and why

The previous system was a two-ink risograph poster: pink surround, 3px black borders,
square containers, pill buttons, three type families, stepped motion. It was memorable and
it was wrong for this product, in three specific ways that showed up as soon as there was
real content in it:

1. **It spent the horizontal budget on ceremony.** A meander rail, a halftone header, a
   scrolling ticker and a 32px pink surround took roughly 200px of vertical and 64px of
   horizontal before a single word of the candidate's material. On the review screen the
   editor got 65% of a 1120px column while a preview rail took the rest, which left a chip
   card **284px wide**. Question text clipped mid-word. The register pills wrapped to two
   lines. That is not a cramped card, it is a broken one.
2. **Three type families in one card.** Newsreader at 19px for body, Archivo 800 uppercase
   for headings, DM Mono 12px uppercase with `+0.06em` tracking for every label. A single
   chip card used all three. The result reads as three products stacked, which is what
   "the font sizes are funky" describes.
3. **Pink is not a neutral.** As a full-card fill for the three selected chips, plus the
   page surround, plus the counter strip, plus the highlight spans, it stopped signalling
   anything. When everything is the accent, nothing is.

This system keeps what was actually load-bearing — state never carried by hue alone, the
withholding rule as engineering, a real focus ring — and throws out the rest.

**Adapted from a marketing language.** The source analysis for this file documents
Intercom's *marketing site*: pricing cards, testimonial cards, CTA banners, logo tiles,
product-screenshot-led rhythm. None of that exists here. What carries over is the
foundation — cream canvas, charcoal primary, one orange accent, a single type family, a
modest radius scale, depth by surface change rather than shadow. The component vocabulary
below is this product's, not Intercom's.

**On the palette.** Warm cream plus a warm accent is the default an AI reaches for on any
"premium / editorial" brief, and reaching for it by reflex is a tell. It is used here
because the brief names `#f5f1ec` and `#ff5600` explicitly, not because a cream page
felt tasteful. If those two values ever stop being the brief, this file changes with them.

---

## 1. The three commitments

**Cream is the ground, white is the figure.** The page is `--canvas` #f5f1ec. Anything the
candidate edits sits on a white `--surface` card. That surface change *is* the hierarchy —
there are no drop shadows in this system. A white card on cream reads as lifted without
costing a single blurred pixel.

**One family, one accent.** Geist carries display, body, label and button. Geist Mono
appears in exactly one place: section ids, which are strings the candidate must be able to
compare character by character. Orange appears in exactly one meaning: **this is live to a
recruiter.** Not "selected", not "correct", not "active" — public.

**Density is the point.** This is a working editor holding 14 sections, 8 questions and 12
quiz items. It is not a landing page and it does not get landing-page air. Sections
separate by 32–48px, not 96px. The candidate should be able to see a chip card and its
source in one glance without scrolling.

**Adjectives that apply:** calm, warm, legible, dense, matter-of-fact, editorial.
**Adjectives that do not:** loud, punk, playful, glassy, brutalist, gradient, "clean SaaS".

---

## 2. Colour

Charcoal is the primary. Orange is a signal, not a brand wash.

| Token | Hex | Role |
|---|---|---|
| `--canvas` | `#f5f1ec` | The page. Warm cream, never pure white. |
| `--surface` | `#ffffff` | Cards, inputs, panels — anything being edited. |
| `--surface-sunk` | `#efeae2` | One step darker than canvas. Table zebra, inactive tabs, code. |
| `--hairline` | `#d3cec6` | 1px card and input borders. The default boundary. |
| `--hairline-soft` | `#e5e0d8` | Dividers inside a card, between list rows. |
| `--ink` | `#111111` | All headlines, body, labels. The system primary. |
| `--ink-muted` | `#626260` | Secondary — helper text, meta, inactive tab labels. |
| `--ink-subtle` | `#6a6a67` | Tertiary - captions, placeholder, counts. Clears AA on every ground in this system. |
| `--ink-faint` | `#9c9fa5` | Disabled only. Never carries meaning. |
| `--on-ink` | `#ffffff` | Text on a charcoal fill. |
| `--live` | `#ff5600` | **Public to a recruiter.** Nothing else. |
| `--live-wash` | `#fff1e9` | Orange at ~8%. The tint behind a live card. |
| `--live-hairline` | `#ffc7a8` | Border of a live card. |
| `--danger` | `#c0362c` | Destructive confirmation and hard validation failure. |
| `--danger-wash` | `#fbeae8` | Behind an error notice. |

### Measured contrast (WCAG 2.1)

| Foreground | Background | Ratio | Verdict |
|---|---|---|---|
| `--ink` | `--canvas` | 16.79 | Pass AAA |
| `--ink` | `--surface` | 18.88 | Pass AAA |
| `--ink` | `--live-wash` | 17.09 | Pass AAA |
| `--ink-muted` | `--canvas` | 5.44 | Pass AA all sizes |
| `--ink-muted` | `--surface` | 6.11 | Pass AA all sizes |
| `--ink-subtle` | `--surface` | 5.43 | Pass AA all sizes |
| `--ink-subtle` | `--canvas` | 4.83 | Pass AA all sizes |
| `--ink-subtle` | `--surface-sunk` | 4.53 | Pass AA all sizes |
| `--on-ink` | `--ink` | 18.88 | Pass AAA |
| `--live` | `--surface` | 3.19 | **Never body text.** Large text 18px+, borders and fills only. |
| `--on-ink` | `--live` | 3.19 | **Large text only.** Passes 3:1 at 16px/600; fails at 15px. |
| `--danger` | `--surface` | 5.52 | Pass AA |
| `--ink-faint` | `--surface` | 2.65 | Disabled only. Exempt under WCAG 1.4.3. |

Every ratio above is computed, not estimated. `--ink-subtle` started at `#7b7b78` (the
value in the source analysis) and was darkened to `#6a6a67` because 4.25:1 on white fails
AA for body, and this token is the placeholder colour.

### The two rules that matter

> **Orange means public. It never means selected, active, correct or important.**

The candidate makes exactly one decision that changes what a stranger sees: which three of
eight questions reach the front page. Those three, and the publish action, are orange.
Everything else — the active tab, the correct quiz answer, a focused input, a hovered row
— is charcoal. If orange starts appearing on things that are not public, it stops being
information.

> **Never encode state in hue alone.**

Orange always arrives with a second signal: a `--live-hairline` border *and* a text label
(`Live to recruiters`). The system stays readable in greyscale and to a colourblind
candidate, which was the one genuinely good instinct in the system this replaces.

State without hue, for everything that is not public:

| State | Treatment |
|---|---|
| Selected / active | `--surface` white fill lifted off cream, `--ink` label, 1px `--hairline` |
| Correct answer | Charcoal-filled radio, `--ink` label at weight 500 |
| Draft | `--ink-subtle` label reading `Draft`. No stripe, no pattern. |
| Warning / thin result | `--surface-sunk` fill, 1px `--hairline`, `--ink` text, an icon |
| Invalid | `--danger` 1px border, `--danger` helper text below the input |
| Disabled | `--ink-faint` text, `--hairline-soft` border, no fill change |

---

## 3. Typography

One family. Hierarchy is size, weight and tracking — never a family change.

| Family | Source | Used for |
|---|---|---|
| **Geist** (variable, 400/500/600) | `next/font/google` | Everything. |
| **Geist Mono** (400) | `next/font/google` | Section ids (`agoda/psp-routing#circuit-breakers`) and nothing else. |

Geist is the free substitute the brief names for Saans. It is a geometric grotesk with the
same confident-without-bold character at weight 500, and unlike Inter it is not the
default every generated interface already uses.

### Scale

| Token | Size / Line | Weight | Tracking | Used for |
|---|---|---|---|---|
| `type-display` | 40 / 46 | 500 | `-0.02em` | The candidate's name on the review screen. One per page. |
| `type-headline` | 28 / 34 | 500 | `-0.018em` | Page titles, empty-state headings. |
| `type-title` | 22 / 28 | 500 | `-0.012em` | Card titles, section titles, quiz question text. |
| `type-subhead` | 20 / 28 | 500 | `-0.008em` | Chip question text. The thing being edited. |
| `type-body-lg` | 18 / 28 | 400 | `-0.004em` | Lead paragraphs, the one-line explainer per tab. |
| `type-body` | 16 / 25 | 400 | `0` | Default. Inputs, list rows, card copy. |
| `type-body-sm` | 14 / 21 | 400 | `0` | Helper text, table cells, secondary card copy. |
| `type-label` | 14 / 18 | 500 | `0` | Field labels and section eyebrows. **Sentence case.** |
| `type-caption` | 12 / 16 | 400 | `0` | Counts, timestamps, footnotes. |
| `type-button` | 15 / 18 | 500 | `0` | Every button. |
| `type-mono` | 13 / 20 | 400 | `0` | Section ids. Tabular numerals on. |

### Hard rules

- **No all-caps, anywhere, ever.** The previous system set labels at 13px uppercase with
  `+0.08em` tracking and meta at 12px uppercase mono. A 90-character all-caps mono string
  ("Four options - the right one, and three a competent generic engineer would give") is
  the single least readable thing on the old review screen. Labels are sentence case at
  14/500. If a label needs to shout, it is in the wrong place.
- **Negative tracking scales with size.** `-0.02em` at 40px down to `0` at 16px. Body never
  gets negative tracking; display never gets none.
- **Only one `type-display` per page.**
- **Reading measure caps at 72ch** for `type-body-lg` and `type-body`. Editor fields are
  exempt: an input that holds a question must be as wide as its container.
- **Mono is not a decoration.** It appears on section ids because those are compared
  character by character. It does not appear on counts, prices, timestamps or status.
- **Numbers that change in place** (`3 / 3`, `12 questions`) use `font-variant-numeric:
  tabular-nums` on Geist, not a switch to mono.

---

## 4. Shape, depth and space

### Radius

One scale, applied consistently. There are no pills on buttons in this system.

| Token | Value | Used for |
|---|---|---|
| `rounded-xs` | 4px | Inline tags, the count badge |
| `rounded-sm` | 6px | Register chips, small toggles |
| `rounded-md` | 8px | **All buttons, all inputs, all textareas** |
| `rounded-lg` | 12px | Cards — chip, quiz item, section row, notice |
| `rounded-xl` | 16px | Panels — the tab panel, the preview rail, the dropzone |
| `rounded-full` | 9999px | Avatars only |

### Depth

Four planes, no blur anywhere.

| Plane | Treatment | Used for |
|---|---|---|
| 0 · Canvas | `--canvas` flat cream | The page |
| 1 · Surface | `--surface` white, no border | Cards inside a bordered panel |
| 2 · Bordered | `--surface` + 1px `--hairline` | Standalone cards, inputs, panels |
| 3 · Overlay | `--surface` + 1px `--hairline` + `0 16px 40px -12px rgb(17 17 17 / 0.16)` | Dialogs and dropdowns only |

Plane 3 is the **only** shadow in the system, it is tinted to the ink hue rather than pure
black, and it exists because an overlay genuinely floats above the page. Cards do not get
it. Hover does not get it.

### Space

Base unit 4px. Scale: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`.

- Card interior padding: 20px on a compact row, **24px on a chip or quiz card**.
- Panel interior padding: 24px.
- Gap between cards in a grid: 16px.
- Gap between blocks inside a card: 16px.
- Section rhythm on a working screen: 32px. On the studio list: 48px.
- Button padding: 10px vertical, 18px horizontal.

---

## 5. Layout — the fix for the horizontal budget

This is the section that exists because of the complaint. The numbers are the point.

### The frame

The app is a cream page with a white content column. No surround margin, no border, no
meander rail, no ticker. Chrome that does not carry information is deleted rather than
restyled.

```
┌─ canvas #f5f1ec ─────────────────────────────────────────────────┐
│  ┌─ header, 64px, hairline bottom ──────────────────────────┐    │
│  │  Reverse Interview      Studio            Signed in as ▾ │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│      ┌── content, max-w 1440, px-8 ────────────────────────┐     │
│      │                                                      │     │
│      └──────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

- Header height **64px**, one line, sticky. Never two lines at desktop.
- Content `max-width: 1440px`, 32px horizontal padding, centred.
- The studio list and `/studio/new` cap their *reading* column at 720px; the review screen
  uses the full 1440.

### The review screen grid

| | Before | After |
|---|---|---|
| Content width | 1120 | **1376** (1440 − 2×32) |
| Editor column | 736 (65%) | **1024** (75%) |
| Preview rail | 352 | **320**, fixed, `≥1280` only |
| Chip card | **284** | **472** at 2-up, **976** at 1-up |

The preview rail becomes a fixed 320px aside rather than a third of the grid, and it
disappears below 1280 instead of squeezing the editor. It stays on screen because it is
the thing that proves the withholding rule — but it is a reference, not a co-equal column.

### The chip card, specifically

At 2-up the card is 472px, which fits the question input and three register chips on one
line with room to spare. At 1-up (below 1536, or when the candidate collapses the preview)
the card is 976px and switches to a **two-column interior**: the question and its register
on the left at 60%, the reasoning and source on the right at 40%.

```
2-up  (≥1536)                          1-up  (<1536)
┌────────────────┐ ┌────────────────┐  ┌──────────────────────────────────────┐
│ Question 1     │ │ Question 2     │  │ Question 1              Live to      │
│                │ │                │  │                         recruiters   │
│ [question    ] │ │ [question    ] │  │ ┌────────────────┐ ┌───────────────┐ │
│                │ │                │  │ │ [question    ] │ │ Why this one  │ │
│ Skeptical      │ │ Skeptical      │  │ │                │ │ [reasoning  ] │ │
│ Narrative Blunt│ │ Narrative Blunt│  │ │ Skeptical      │ │               │ │
│                │ │                │  │ │ Narrative Blunt│ │ Answers from  │ │
│ Why this one   │ │ Why this one   │  │ │                │ │ [mono id    ] │ │
│ [reasoning   ] │ │ [reasoning   ] │  │ └────────────────┘ └───────────────┘ │
│                │ │                │  │                                      │
│ [Use] [Rewrite]│ │ [Use] [Rewrite]│  │ [Use this one] [Rewrite] [Delete]    │
└────────────────┘ └────────────────┘  └──────────────────────────────────────┘
```

Both are declared explicitly. "Tailwind will handle it" is not a mobile strategy.

### Breakpoints

| Name | Width | Behaviour |
|---|---|---|
| `2xl` | ≥1536 | Chip and quiz cards 2-up. Preview rail visible. |
| `xl` | 1280–1535 | Cards 1-up with the two-column interior. Preview rail visible. |
| `lg` | 1024–1279 | Preview rail hidden. Cards 1-up, full width. |
| `md` | 768–1023 | Card interiors collapse to one column. Tabs scroll horizontally. |
| `sm` | <768 | Single column, 16px padding. Header collapses to a menu. |

Touch targets ≥44px on every interactive element at `md` and below.

---

## 6. Components

### 6.1 Button

8px radius, 15/500 label, 10px/18px padding, one line always. No pills.

| Variant | Rest | Hover | Active | Disabled |
|---|---|---|---|---|
| `primary` | fill `--ink`, text `--on-ink` | `#000000` | `translate-y-px` | fill `--surface-sunk`, text `--ink-faint` |
| `secondary` | fill `--surface`, text `--ink`, 1px `--hairline` | fill `--surface-sunk` | `translate-y-px` | as above |
| `ghost` | no fill, text `--ink-muted` | fill `--surface-sunk`, text `--ink` | `translate-y-px` | text `--ink-faint` |
| `live` | fill `--live`, text `--on-ink` at **16/600** | `#e64d00` | `translate-y-px` | as above |
| `danger` | fill `--surface`, text/border `--danger` | fill `--danger-wash` | `translate-y-px` | as above |

`live` is the publish action and nothing else. Its label steps up to 16/600 because white
on `#ff5600` is 3.4:1 — below AA at 15px, above the 3:1 large-text threshold at 16px/600.
That is a real constraint, not a style choice: at 15px the label would fail.

Tactile feedback is a 1px downward translate over 120ms. There is no lift, no shadow
toggle, no stepped easing.

### 6.2 Chip card — the one that was broken

The product of Journey 1. Eight are generated, three go public.

- Container: `--surface`, 1px `--hairline`, 12px radius, 24px padding.
- **Live variant:** `--live-wash` fill, 1px `--live-hairline`, and a `Live to recruiters`
  label at 14/500 in `--ink` with a 12px orange dot. Three signals, one of them non-chromatic.
- Question: `type-subhead` (20/500) in a `--surface` input at 8px radius, full card width.
  It must never clip. If the text is longer than the field, the field scrolls; the card
  does not shrink the field to fit.
- Register: three 6px-radius chips, `type-body-sm`, on **one line**. Selected is charcoal
  fill; unselected is `--surface` with a hairline.
- Reasoning: `type-body-sm` in `--ink-muted`, in a borderless textarea on `--surface-sunk`.
- Source id: `type-mono` in a `--surface` input, 8px radius.
- Actions: `Use this one` / `Rewrite` / `Delete`, left-aligned, above a 16px gap from a
  `--hairline-soft` rule.

**Unresolved reference:** the source input takes a `--danger` border and a `--danger`
helper line below reading `This section is not in your knowledge base.` No hatch pattern,
no gutter stripe.

### 6.3 Quiz item

- Container: `--surface`, 1px `--hairline`, 12px radius, 24px padding.
- Question: `type-title` (22/500), borderless textarea, auto-growing.
- Four options: each a row with a 20px radio and a `type-body` input. The correct row gets
  a charcoal-filled radio and its input goes `--surface-sunk` with `--ink` at weight 500.
  **Not orange** — a correct answer is not public, it is the opposite.
- Category grouping: a `type-label` heading (14/500 sentence case) with a `n / 3` count in
  `type-caption`, over a `--hairline-soft` rule. Not a 32px uppercase display heading.

### 6.4 Section row

A collapsed row, not a card, because there are 14 of them.

- `--surface`, 1px `--hairline`, 12px radius, 20px padding.
- Ordinal in `type-caption` `--ink-subtle`, then title in `type-title` inline-editable.
- Summary in `type-body-sm` `--ink-muted`, two lines clamped when collapsed.
- Path and anchor in `type-mono` inputs on one line.
- A `Cited` tag (`rounded-xs`, `--surface-sunk`, `type-caption`) when something references
  it. Charcoal, not orange — being cited is not being public.

### 6.5 Tabs

Underline, not file folders. Square-topped tabs on a 3px rule was poster furniture.

- Row of `type-label` (14/500) buttons, 12px vertical padding, `--ink-muted`.
- Active: `--ink` text and a 2px `--ink` underline flush to the bottom of the row.
- Each carries a count in `type-caption` `--ink-subtle`; the Questions tab carries `n / 3`.
- The row sits directly on the canvas; the panel below is a `--surface` 16px-radius card.

### 6.6 Input, textarea, select

- `--surface` fill, 1px `--hairline`, 8px radius, 10px/14px padding, `type-body`.
- Placeholder `--ink-subtle` at 5.43:1 on white. Contrast was never the old system's
  failure; the failure was that labels were 13px uppercase mono.
- **Focus:** `outline: 2px solid var(--ink); outline-offset: 2px`. Charcoal, not orange,
  because focus is not public. Never `outline: none`.
- **Invalid:** 1px `--danger` border plus a `type-body-sm` `--danger` message below. Two
  signals; no pattern fill.
- Label above, 14/500, sentence case, 8px gap. Helper text below the label, above the
  field. Error below the field. Never placeholder-as-label.

### 6.7 Notice

Replaces the poster's hatch-gutter warning box.

- `--surface-sunk` fill, 1px `--hairline`, 12px radius, 20px padding, no left stripe.
- Heading `type-label`, body `type-body-sm` `--ink-muted`.
- `danger` tone: `--danger-wash` fill, 1px `--danger` at 30% opacity, heading in `--danger`.

### 6.8 Table — the studio list

- No outer border. Header row `type-label` `--ink-muted`, `--hairline` bottom rule only.
- Body rows on `--canvas`, separated by `--hairline-soft`. No zebra: at five columns the
  stripe is noise.
- Row hover `--surface`. The name cell is `type-title`.
- Status in `type-body-sm`: `Published` in `--ink`, `Draft` in `--ink-subtle`,
  `Building…` in `--ink-muted`, `Ingestion failed` in `--danger`.

### 6.9 Dropzone

- 2px dashed `--hairline`, 16px radius, `--surface` fill, 200px tall.
- Heading `type-title` sentence case: `Drop your documents here.`
- On drag-over: `--live-wash` fill and a `--live` dashed border. This is the one place
  orange appears without meaning "public", and it is justified: it is a transient drop
  target, it carries no state after the drop, and there is no second meaning to confuse.

### 6.10 Empty and loading states

- No spinners, no shimmer. A loading region is a `--surface-sunk` block at the final
  layout's shape and size, so nothing shifts when content arrives.
- The ingestion panel is a `--surface` 16px card with a `type-body` status line that
  updates in place, and no percentage that cannot be honoured.
- Empty state: `--surface` card, `type-headline` line, one `type-body` line, one primary
  button. Copy is plain: `Nothing here yet. Build one.`

---

## 7. Motion

`MOTION_INTENSITY: 3`. This is an editing surface. Motion is feedback, never decoration.

| Motion | Spec |
|---|---|
| Button press | `transform 120ms ease-out`, 1px down |
| Hover fill | `background-color 120ms ease-out` |
| Tab switch | none. Instant. |
| Dialog enter | `opacity 0→1` + `translateY(4px→0)` over `140ms ease-out` |
| Save indicator | text swap, no animation |

No scroll-triggered reveals, no parallax, no marquees, no infinite loops, no stepped
easing. Under `prefers-reduced-motion: reduce`, transitions collapse to 0.01ms.

Every one of these is justifiable in one sentence: the press confirms a click landed, the
hover confirms a target is live, the dialog says something arrived on top. Nothing else
moves.

---

## 8. Do's and don'ts

**Do**

- Lift what is being edited onto white; leave everything else on cream.
- Use orange for exactly one thing: what a recruiter will see.
- Pair orange with a border and a text label, every time.
- Keep labels sentence case at 14/500.
- Let editor fields use the full width of their container.
- Give the correct quiz answer a charcoal fill, not an orange one.
- Cap reading columns at 72ch and leave input fields uncapped.

**Don't**

- ❌ All-caps anything. No tracked labels, no uppercase headings, no mono caps.
- ❌ A second accent colour. Not for a badge, not for a chart, not for "just this one".
- ❌ Orange on anything that is not public.
- ❌ Drop shadows on cards. Plane 3 is dialogs only.
- ❌ Pill-rounded buttons, or any radius outside the §4 scale.
- ❌ Pure white as the page background, or pure black as text.
- ❌ A second type family. Geist Mono is for section ids, not for flavour.
- ❌ Em-dashes in visible copy. Use a comma, a colon, a full stop, or a hyphen.
- ❌ Decorative patterns — halftone, hatch, meander. If a state needs a signal, it gets a
  border and a word.
- ❌ Ceremony that costs layout: rails, tickers, surrounds, window dots.

---

## 9. Implementation notes

```css
/* globals.css */
@import "tailwindcss";

@theme {
  --color-canvas:        #f5f1ec;
  --color-surface:       #ffffff;
  --color-surface-sunk:  #efeae2;
  --color-hairline:      #d3cec6;
  --color-hairline-soft: #e5e0d8;
  --color-ink:           #111111;
  --color-ink-muted:     #626260;
  --color-ink-subtle:    #6a6a67;
  --color-ink-faint:     #9c9fa5;
  --color-on-ink:        #ffffff;
  --color-live:          #ff5600;
  --color-live-wash:     #fff1e9;
  --color-live-hairline: #ffc7a8;
  --color-danger:        #c0362c;
  --color-danger-wash:   #fbeae8;

  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  --shadow-overlay: 0 16px 40px -12px rgb(17 17 17 / 0.16);
}
```

```ts
// app/fonts.ts
import { Geist, Geist_Mono } from "next/font/google";
```

**Files this system touches, in build order:**

1. `app/globals.css` + `app/fonts.ts` — tokens and families. Everything else inherits.
2. `components/frame/AppFrame.tsx` — delete the rail, ticker, surround and border.
3. `components/ui/{button,input,textarea,tabs,dialog}.tsx` — the primitives.
4. `components/kb/ChipCard.tsx` — the card the complaint is about.
5. `components/studio/{ChipsTab,QuizTab,SectionsTab,PreRollTab}.tsx`.
6. `components/studio/{ReviewScreen,PublicPreviewPanel,KBTable}.tsx` — the grid.
7. `components/interview/{PreRollCard,SectionIndex,RecruiterPreview}.tsx`.

**Accessibility checklist before shipping:** charcoal 2px focus ring on every interactive
element; the live state readable in greyscale; `aria-live="polite"` on the save indicator
and the ingestion status; every orange surface carries a text label; `prefers-reduced-motion`
honoured; contrast re-measured against §2 whenever a colour changes.

---

## 10. Agent prompt guide

**Quick reference:** canvas `#f5f1ec` · surface `#ffffff` · ink `#111111` · muted `#626260`
· subtle `#6a6a67` · hairline `#d3cec6` · live `#ff5600` (public only) · danger `#c0362c`. Geist everywhere,
Geist Mono for section ids. Radius 8 buttons/inputs, 12 cards, 16 panels. One shadow, on
dialogs. Sentence case, never caps.

**Prompt — a new screen**

> Build `<screen>` following NEW_DESIGN.md. Cream `#f5f1ec` page, white cards, 1px
> `#d3cec6` hairlines, no drop shadows except on dialogs. Geist at 400/500 — sentence case
> everywhere, no all-caps and no letter-spaced labels. Buttons and inputs at 8px radius,
> cards at 12px, panels at 16px. Charcoal `#111111` is the primary; orange `#ff5600` means
> "public to a recruiter" and nothing else, and never appears without a border and a text
> label beside it. Editor fields take the full width of their container. Motion is a 120ms
> press and a 140ms dialog, nothing more.

**Prompt — reviewing generated UI**

> Check this against NEW_DESIGN.md and list violations: any all-caps or letter-spaced
> label; orange used for something that is not public; orange without a second signal; a
> drop shadow on a card; a radius outside 4/6/8/12/16; a second type family; mono outside
> section ids; an em-dash in visible copy; an input narrower than its content; a decorative
> pattern; text on cream below 4.5:1.
