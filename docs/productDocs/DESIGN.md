# DESIGN.md

**Project:** Knowledge Access Platform — chat-native tutoring from Key People of Influence
**Design language:** `RISO POSTER` — two-ink risograph print, rendered as software
**Platform:** Next.js (App Router) · Tailwind v4 · shadcn/ui · light theme only
**Primary targets:** laptop 1280–1680 · tablet 768–1279 · mobile is a documented fallback, not a design target
**Status:** v1, weekend POC. Written to be read by a coding agent.

---

## 1. Visual Theme & Atmosphere

This product is one person's opinions, sold. The interface should feel like **a printed thing made by a person with a point of view** — a risograph gig poster, a zine, a small-press manifesto — not like a course platform.

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
| `--paper-tint` | `#FDF4FB` | Pink at ~6%. Secondary surfaces inside the sheet: syllabus rail, code blocks, table stripes. |
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

Never encode state in hue alone: `--pink` also always changes the *shape* (outline circle → filled circle) so the syllabus rail is readable to a colorblind user and in a black-and-white screenshot.

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

Three families, each with a job. The split is semantic, not decorative — **the Specialist's words are set in serif; the application's own voice is set in grotesk.** A student reading a lesson should be able to tell, without reading, which sentences they paid for.

| Family | Source | Used for |
|---|---|---|
| **Archivo** (variable, `wght` 400–900, `wdth` 62–125) | Google Fonts | Display, headings, all UI chrome, buttons, nav, the Seeker's own chat turns |
| **Newsreader** (variable, `opsz` 6–72) | Google Fonts | Lesson bodies, the Specialist's chat turns, position `because` and `pushback`, citation quotes |
| **DM Mono** (400, 500) | Google Fonts | Prices, lesson ordinals, progress %, turn counters, timestamps, IDs |

### Scale

| Token | Size / Line | Family & treatment | Used for |
|---|---|---|---|
| `display-xl` | 64 / 60 | Archivo 800, `wdth` 110, `-0.02em`, **UPPERCASE** | Marketing hero only. Max 4 words per line. |
| `display-l` | 44 / 44 | Archivo 800, `-0.02em`, **UPPERCASE** | Page titles, position `claim` lines |
| `display-m` | 32 / 34 | Archivo 800, `-0.01em`, **UPPERCASE** | Section heads, course title on `/c/:slug` |
| `title` | 22 / 28 | Archivo 700, sentence case | Card titles, lesson titles, dialog headers |
| `body-l` | 19 / 32 | Newsreader 400 | **Lesson body, Specialist chat turns.** The reading size. |
| `body` | 16 / 26 | Archivo 400 | UI copy, forms, Seeker chat turns |
| `body-s` | 14 / 22 | Archivo 400 | Helper text, secondary card copy |
| `label` | 13 / 16 | Archivo 600, `+0.08em`, **UPPERCASE** | Buttons, tabs, nav, chips, table headers |
| `meta` | 12 / 16 | DM Mono 400, `+0.06em`, **UPPERCASE** | Price, `LESSON III`, `30%`, `2 OF 5 LEFT` |

### Hard rules

- **Uppercase is for ≤ 8 words.** Headlines, labels, buttons, ticker. Never a sentence, never body copy, never a lesson objective longer than a phrase. All-caps destroys word-shape recognition; it is a poster device, not a text device.
- **Measure is capped at 68ch** for `body-l` and 72ch for `body`. In `/learn`, the thread column is `max-width: 68ch` regardless of viewport. Wide reading columns are the single most common way a brutalist layout becomes unreadable.
- **Only one `display-xl` per page.** Ever.
- Never letter-space lowercase text. Positive tracking is for caps only.
- Never set Newsreader in caps. Never set Archivo 800 at body sizes.
- Numerals: DM Mono is tabular by default — use it anywhere numbers change in place (progress %, turn counters), so nothing shifts.

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

Square. `--bd` 2px black on `--paper`. No shadow at rest. A card that is *pickable* (course card, position card) gets `--lift` on hover plus `translate(-3px,-3px)`; a card that is merely a container never lifts.

### 4.3 Course card — `/` catalog

```
┌──────────────────────────────────────┐  2px, square
│  (◉) 64px avatar, duotoned,          │  circle, 3px black ring
│      3px black ring                  │
│                                      │
│  RAHUL MEHTA            ← label caps │
│  Pricing for B2B SaaS   ← title      │
│  Stop guessing. Charge more than     │  body-s, --ink-muted
│  feels comfortable.                  │
│                                      │
│  ▌ "If you have to sell hard, your   │  first positions[0].claim,
│  ▌  offer is broken."                │  Newsreader italic, 3px pink left rule
│                                      │
│  ┌───────┐                           │
│  │ $299  │  ← meta, pink block fill  │
│  └───────┘                           │
└──────────────────────────────────────┘
```

Grid: 3-up at ≥1280, 2-up at 768–1279. Gap 24px.

### 4.4 Avatar — duotone treatment (mandatory)

Specialists upload arbitrary photographs. An unprocessed photo destroys a two-ink system instantly. Every avatar and hero portrait is duotoned to black + pink in CSS:

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

### 4.5 Position card — the paid asset

Three zones, three type treatments. This component is the product; give it the most care.

```
┌──────────────────────────────────────────┐  3px border
│  CLAIM ────────────────────────────────  │  meta label
│  ▓▓ If you have to sell hard, your ▓▓    │  display-l caps? NO —
│  ▓▓ offer is broken. ▓▓                  │  title 22px, pink highlighter
│                                          │
│  BECAUSE ─────────────────────────────   │  meta label
│  Persuasion is a tax you pay for a       │  body-l Newsreader
│  weak offer. Fix the offer and the       │
│  selling gets easy.                      │
│                                          │
│  WHEN THEY PUSH BACK ─────────────────   │  meta label
│  ┌────────────────────────────────────┐  │  pink-wash fill, 1.5px border
│  │ "My closing rate is fine" → then   │  │  body-l Newsreader italic
│  │ you're leaving price on the table. │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

**Locked variant** (`/c/:slug`, three cards, `because` hidden): the `BECAUSE` zone is replaced by a **halftone-filled block** of the correct height with a centred black pill reading `🔒 UNLOCK`. `WHEN THEY PUSH BACK` is not rendered at all.

> ⚠️ **Engineering, not styling:** do not render the real text and blur it with CSS. `GET /api/courses/:slug` must omit `because` and `pushback` for unauthenticated requests. A `filter: blur()` is one devtools inspection away from giving the product away, and the whole conversion mechanic depends on it being withheld.

### 4.6 Chat thread — asymmetric by design

**Do not use symmetric left/right bubbles.** The Specialist is publishing; the Seeker is interjecting. The geometry should say so.

```
  ┌ RAHUL ─────────────────────────────────────┐   Specialist turn:
  │ (◉)  What are you actually trying to do?    │   NO border, NO fill.
  │      And what have you already tried that   │   Newsreader body-l 19/32,
  │      didn't work?                           │   full 68ch column,
  │                                             │   name in meta caps above,
  │      ▸ FROM LESSON II                       │   32px avatar at left gutter.
  └─────────────────────────────────────────────┘

                        ┌──────────────────────┐   Seeker turn:
                        │ I charge $2k and     │   2px black border, square,
                        │ close about 1 in 10. │   --paper-tint fill,
                        └──────────────────────┘   Archivo body 16/26,
                                                   max 44ch, right-aligned,
                                                   no avatar, no name.
```

The Specialist's words get the page. The Seeker's get a box. Turn spacing: 32px between speakers, 12px within a speaker's consecutive turns.

**Streaming cursor:** a solid pink block, blinking in steps — not a fading dot triad.

```css
.stream-caret {
  display:inline-block; width:.55em; height:1.05em; background:var(--pink);
  vertical-align:-.15em; animation: caret 1s steps(2,start) infinite;
}
@keyframes caret { 50% { opacity: 0 } }
```

### 4.7 Citation chip

`▸ FROM LESSON III` — pill, 1.5px black border, `meta` type, `--paper` fill. Hover: `--pink` fill. Click: expands *inline beneath the turn* into a bordered quote block, `--pink-wash` fill, 3px black left rule, Newsreader italic, with a `meta` caption naming the lesson. Expansion is instant — no height animation.

### 4.8 Syllabus rail — the roman numeral list

Lifted directly from the reference: `I II III IV` in outlined circles down a rail.

| State | Circle | Label |
|---|---|---|
| `passed` | 28px, fill `--ink`, `--paper` ✓ glyph | Archivo 600, `--ink`, strikethrough off |
| `active` | 28px, fill `--pink`, 2px `--ink` border, roman numeral in `--ink` | Archivo 700, `--ink` |
| `locked` | 28px, `--paper` fill, 2px `--ink-faint` border, numeral in `--ink-faint` | Archivo 400, `--ink-faint` |

Rail background `--paper-tint`, separated from the thread by a 3px black rule. Width 280px fixed. Labels are 15px/1.4 (not `body`) — at 280px with a 28px numeral and 20px padding, 16px wraps three-line titles badly. Numerals are DM Mono 500 at **10px**, not 12px: `VII` at `meta` size overflows a 28px circle.

Do **not** put the pink highlighter behind the active label — it breaks across wrapped lines and looks like a rendering fault. The filled pink circle plus Archivo 700 is enough, and it survives greyscale.

### 4.9 Progress meter — discrete blocks, not a bar

```
PROGRESS                              30%
┌───┬───┬───┬───┬───┬───┬───┐
│▓▓▓│▓▓▓│   │   │   │   │   │   7 blocks = 7 lessons
└───┴───┴───┴───┴───┴───┴───┘
```

2px black track, one cell per lesson, filled `--pink`. When `mark_progress` fires, the next block fills in a single `steps(1)` 140ms snap — no easing, no tween. This is the only reward animation in the product; a discrete *snap* reads as an achievement, a smooth fill reads as loading.

### 4.10 Input / Textarea / Select

Square, 2px `--ink` border, `--paper` fill, 12px 16px padding, Archivo `body`. Placeholder `--ink-muted`.
**Focus:** `outline: 3px solid var(--ink); outline-offset: 3px;` — a black ring with a paper gap. No pink glow, no border-color change. This ring is legible on both white and pink surfaces, which is why it's black rather than pink.
**Invalid:** border → `--alert`, plus a hatch-filled 4px strip on the left edge, plus a `body-s` message in `--alert`. Three signals, one of them non-chromatic.

The chat composer is the exception: 3px border, 56px min height, auto-grows to 6 lines, with `[SKIP AHEAD]` and `[I'M LOST]` as `sm` secondary buttons pinned to its right edge.

### 4.11 Tabs — file folder

For `/studio/:id` (Positions · Syllabus · Voice). Square-topped tabs sitting on a 3px rule. Active tab: `--ink` fill, `--paper` label, and the rule beneath it is erased so the tab reads as connected to the panel. Inactive: `--paper` fill, `--ink` border, `--ink-muted` label.

### 4.12 The paywall card — `/c/:slug` sample chat

Not a chat bubble. It interrupts the thread as a black block:

```
████████████████████████████████████████████
█  ✕✕  YOU'RE 5 MESSAGES IN  ✕✕            █   --pink caps on --ink,
█                                          █   ticker treatment
█  He's already found your constraint.     █   Newsreader, --paper
█  There are 7 lessons and he'll keep      █
█  asking until you can defend your        █
█  number out loud.                        █
█                                          █
█  ┌──────────────────────┐                █
█  │  GET ACCESS — $299   │  accent button █
█  └──────────────────────┘                █
████████████████████████████████████████████
```

### 4.13 Ticker strip

Black bar, 44px, `--pink` `label` caps, `✕✕` separators, scrolling `translateX` at ~40s/loop. Two uses only: the app frame's bottom edge, and the sample-chat turn counter (`✕✕ 2 OF 5 EXCHANGES LEFT ✕✕`). `prefers-reduced-motion` → static, no scroll.

### 4.14 Empty & loading states

No spinners, no skeleton shimmer. A loading region is filled with the **halftone pattern**; a completed region replaces it with content. Ingestion (30–60s) shows a bordered panel with halftone fill, a `meta` line of streamed status (`READING 4 OF 11 FILES…`), and no progress percentage you can't honour.

Empty states are a bordered box on halftone with one `title` line and one action. Copy is blunt, never apologetic: *"No courses yet. Make one."*

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
| `/` catalog | 12 → 3-up cards (4/4/4) |
| `/c/:slug` | hero 7/5 (copy / portrait) · positions 12 (3-up) · sample chat 8, centred |
| `/learn/:id` | rail 280px fixed + thread fluid, thread column capped 68ch and left-aligned in its area (not centred — the eye should not have to re-find the left edge as messages change length) |
| `/studio/:id` | tab bar 12 · panel 8/4 (editor / live preview) |
| `/checkout` | single 6-col column, centred |

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
| 3 · Overlay | `--paper`, 3px border, `--lift-lg` (`8px 8px 0 --ink`) | Dialogs, the ingestion panel. Backdrop is `--pink` at 92% opacity — **not** black at 50%. A pink scrim keeps the print language; a black scrim looks like every other web app. |

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
- ❌ CSS-blurring locked content instead of withholding it server-side.
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
| `md` (tablet — real target) | 768–1279 | 16px surround. Catalog 2-up. `/studio` preview panel collapses under the editor. `/learn` rail collapses into a sticky top strip: `[ ☰ II · SIZING ]` chip + inline progress meter; tapping opens the full rail as a left sheet at plane 3. All touch targets ≥44px — the `md` button size already satisfies this, so *never use `sm` buttons for primary actions on tablet*. `display-xl` steps down to 48/46. |
| `sm` (fallback, not designed) | <768 | Surround → 0, frame border → 2px, meander rail hidden, ticker hidden. Single column throughout. Catalog 1-up. `/learn` is thread-only with the rail behind the ☰ chip. `display-l` → 32/34. Ship it working, not polished. |

Touch: hover-only affordances must have a non-hover equivalent. The card lift is decorative (fine); the citation chip's hover fill is not the only signal (the ▸ glyph rotates to ▾ on expand).

---

## 9. Motion

Print doesn't ease. Everything in this system moves in **steps**.

| Motion | Spec |
|---|---|
| Button hover/press | `transform 90ms steps(3)` |
| Card lift | `transform 120ms steps(3)`, shadow toggles with no transition |
| Progress block fill | `140ms steps(1)` — a snap, one block at a time |
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

Eight screens. Each entry is what an agent needs to build it.

### `/` — Catalog
Frame → `display-xl` hero, two lines max, second line pink-highlighted → one `body-l` line of positioning → 3-up course cards (§4.3) → meander divider → footer ticker. No filters, no sort, no search in the POC.

### `/c/:slug` — Course page (the conversion screen)
1. **Hero**, 7/5. Left: `display-m` course title, `body-l` tagline, `meta` price in a pink block, `lg accent` button `GET ACCESS — $299`. Right: duotoned portrait (§4.4) at ~380px on a pink block with halftone corner fill — this is the poster moment, treat it like the reference image's bust.
2. **`WHAT I'LL ARGUE WITH YOU ABOUT`** — `display-m`, then 3 locked position cards (§4.5).
3. **Sample chat**, 8 cols centred, in a 3px bordered sheet with its own ticker header showing `✕✕ N OF 5 EXCHANGES LEFT ✕✕`. Three tappable prompt chips seed it. On turn 5, the paywall card (§4.12) appends beneath the completed reply.
4. **Syllabus**, collapsed. Roman numerals + objectives only, no bodies.

### `/checkout`
6 cols centred. Bordered order summary (avatar, title, price in `meta`). One labelled textarea — **`WHAT ARE YOU TRYING TO DO IN THE NEXT 30 DAYS?`** — prefilled from the sample transcript when present, with a `body-s` `--ink-muted` note: *"He'll open with this."* Then `lg primary` `PAY $299`. The 800ms fake spinner is a halftone-filled bar, not a spinner.

### `/learn/:id` — The product
280px rail (§4.8, progress meter §4.9, `[ASK RAHUL]` secondary button pinned bottom) + thread. Thread header is a thin bordered strip: duotoned 32px avatar, `RAHUL · LESSON II OF VII` in `meta`. Composer at §4.10.

**The reorder moment.** After the Seeker answers the opening diagnostic, the rail visibly reorders: each moved lesson translates to its new position in `160ms steps(4)`, skipped lessons get the hatch treatment and drop to `--ink-faint`, and a `meta` line appears above the rail: `REORDERED FOR YOU · 2 SKIPPED`. Stagger the rows by 60ms. This is the single most important animation in the product — it is the entire argument against video — so it must be *seen*, which is why it's stepped and staggered rather than instant.

### `/studio` — Course list
Table, not cards. 2px rules, `label` caps headers, `--paper-tint` zebra. Draft rows carry the hatch strip (§2). One `lg accent` button: `BUILD A COURSE`.

### `/studio/new` — Upload
Dropzone: 3px **dashed** black border (the only dashed border in the system), halftone fill, 240px tall, `title` copy *"Drop your material here."* Then three inputs: title, tagline, price. One `lg primary` `BUILD MY COURSE`. Ingestion replaces the panel with the halftone loading state (§4.14).

### `/studio/:id` — Review
Tabs (§4.11), **default to Positions**. Position cards in editable form, 2-up, each with `KEEP · SOFTEN · DELETE` as `sm` buttons in the card footer, plus a dashed-border `+ ADD A STANCE` card at the end of the grid. Thin-results empty state, per the design doc: switch default tab to Syllabus and reframe the heading to `WHERE STUDENTS GET STUCK`.

### `/studio/:id/preview`
`/learn` rendered inside a 3px bordered inset with a pink ticker strip pinned to its top: `✕✕ PREVIEW — NOT LIVE ✕✕`.

---

## 12. Implementation Notes (Next.js + Tailwind v4 + shadcn/ui)

```
app/
  layout.tsx          ← fonts + <AppFrame>
  globals.css         ← @theme tokens, patterns, base
  page.tsx            ← /
  c/[slug]/page.tsx
  checkout/page.tsx
  learn/[id]/page.tsx
  studio/…
components/
  frame/AppFrame.tsx  ← BUILD THIS FIRST. Surround + sheet + meander rail + ticker.
  frame/Ticker.tsx
  ui/                 ← shadcn, retheme'd
  course/CourseCard.tsx  PositionCard.tsx  RisoPortrait.tsx
  chat/Thread.tsx  SpecialistTurn.tsx  SeekerTurn.tsx  CitationChip.tsx  Composer.tsx
  learn/SyllabusRail.tsx  ProgressMeter.tsx
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

**Build order** (mapped onto the Sat/Sun plan in `FirstDesign.md`):
1. `AppFrame` + tokens + fonts. Half an hour, and every subsequent screen inherits the look for free.
2. `Thread` + `SpecialistTurn` / `SeekerTurn` + `Composer` — this is `/learn`, which is 90% of the product.
3. `SyllabusRail` + `ProgressMeter` + `CitationChip`.
4. `PositionCard` (locked + editable variants) — reused across `/c/:slug` and `/studio/:id`.
5. `CourseCard`, checkout, ticker polish.

**Accessibility checklist before demo:** black 3px focus ring visible on every interactive element (never `outline: none`); rail states distinguishable in greyscale; `aria-live="polite"` on the streaming turn; `prefers-reduced-motion` honoured on ticker, caret, and progress; every duotoned portrait has real `alt` text.

---

## 13. Agent Prompt Guide

**Quick reference:** ink `#000000` · pink `#F2A0E7` (surface only) · paper `#FFFFFF` · tint `#FDF4FB` · wash `#FBE0F6` · muted `#5C5C5C` · alert `#CC2318`. Archivo (display/UI) · Newsreader (knowledge) · DM Mono (numbers). Containers `radius: 0`, actions `radius: 999px`. Borders 2px/3px black. Shadows hard-offset, zero blur. Motion in `steps()`.

**Prompt — a new screen**

> Build `<screen>` following DESIGN.md. Wrap it in `<AppFrame>`. Two inks only: black `#000000` and pink `#F2A0E7` on white — pink is a surface, never text. Square containers with 2–3px black borders, pill buttons, hard offset shadows (`4px 4px 0 #000`) with zero blur. Archivo 800 uppercase for headings (≤8 words), Newsreader 19/32 for any content the Specialist "said", DM Mono uppercase for numbers. Use the halftone pattern for anything absent, locked, or loading — never a spinner or skeleton shimmer. Transitions use `steps()`, never easing. Cap reading columns at 68ch.

**Prompt — a new component**

> Add `<component>` in the RISO POSTER language from DESIGN.md: `border: 2px solid #000`, `border-radius: 0`, white fill, no shadow at rest; if it's clickable add `transform: translate(-3px,-3px)` + `box-shadow: 4px 4px 0 #000` on hover over `120ms steps(3)`. Labels are Archivo 600 uppercase 13px with `+0.08em` tracking. Any state colour comes from fill and pattern, not hue.

**Prompt — reviewing generated UI**

> Check this against DESIGN.md and list violations: pink used as text on white; any border-radius between 1px and 998px on a container; blurred shadows or gradients; a third hue; uppercase runs over 8 words; reading columns over 68ch; eased transitions; spinners or shimmer skeletons; symmetric chat bubbles; locked content rendered then CSS-blurred.
