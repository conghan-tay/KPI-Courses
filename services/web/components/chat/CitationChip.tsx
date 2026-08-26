"use client";

import { useState } from "react";

import { toRoman } from "@/lib/text";

/**
 * DESIGN.md §4.7 — every substantive claim renders a `▸ FROM LESSON III` pill
 * that expands inline into the source paragraph. It is cheap (the model returns
 * lesson ordinals) and it is the entire anti-hallucination story.
 *
 * Expansion is instant — no height animation — and the glyph rotates ▸ → ▾ so
 * the state is not carried by the hover fill alone.
 */
export function CitationChip({
  lessonOrd,
  lessonTitle,
  quote,
}: {
  lessonOrd: number;
  lessonTitle: string;
  quote: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="type-meta inline-flex cursor-pointer items-center gap-1.5 rounded-pill border-[1.5px] border-ink bg-paper px-3 py-1.5 hover:bg-pink"
      >
        {open ? "▾" : "▸"} From lesson {toRoman(lessonOrd)}
      </button>

      {open && (
        <figure className="mt-2.5 border-l-[3px] border-ink bg-pink-wash px-4 py-3.5">
          <blockquote className="type-body-l italic">{quote}</blockquote>
          <figcaption className="type-meta mt-2 text-ink-muted">
            Lesson {toRoman(lessonOrd)} · {lessonTitle}
          </figcaption>
        </figure>
      )}
    </div>
  );
}
