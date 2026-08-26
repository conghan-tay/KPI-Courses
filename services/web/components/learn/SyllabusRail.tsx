import { ProgressMeter } from "@/components/learn/ProgressMeter";
import { toRoman } from "@/lib/text";
import { cn } from "@/lib/utils";
import type { Lesson } from "@/lib/types";

// DESIGN.md §4.8 — roman numerals in outlined circles down a 280px rail on
// paper-tint, separated from the thread by a 3px rule.
//
// State is never carried by hue alone: `passed` is a filled black disc with a
// paper tick, `active` is a filled pink disc, `locked` is an outline. The rail
// stays readable in greyscale and to a colourblind reader, which is the point.

export type LessonState = "passed" | "active" | "locked";

const CIRCLE: Record<LessonState, string> = {
  passed: "bg-ink text-paper border-ink",
  active: "bg-pink text-ink border-ink",
  locked: "bg-paper text-ink-faint border-ink-faint",
};

const LABEL: Record<LessonState, string> = {
  passed: "font-semibold text-ink",
  active: "font-bold text-ink",
  locked: "font-normal text-ink-faint",
};

export function SyllabusRail({
  lessons,
  activeOrd,
  passedOrds = [],
  note,
  footer,
  className,
}: {
  lessons: Lesson[];
  activeOrd: number;
  passedOrds?: number[];
  /** e.g. "Reordered for you · 2 skipped" */
  note?: string;
  footer?: React.ReactNode;
  className?: string;
}) {
  function stateOf(lesson: Lesson): LessonState {
    if (passedOrds.includes(lesson.ord)) return "passed";
    if (lesson.ord === activeOrd) return "active";
    return "locked";
  }

  return (
    <nav
      aria-label="Syllabus"
      className={cn(
        "flex w-[280px] shrink-0 flex-col gap-5 border-r-[3px] border-ink bg-paper-tint p-5",
        className
      )}
    >
      {note && <p className="type-meta text-ink-muted">{note}</p>}

      <ol className="flex flex-col">
        {lessons.map((lesson) => {
          const state = stateOf(lesson);
          return (
            <li
              key={lesson.ord}
              aria-current={state === "active" ? "step" : undefined}
              className="flex items-center gap-3 py-[7px]"
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border-2",
                  "font-mono text-[10px] leading-none font-medium",
                  CIRCLE[state]
                )}
              >
                {state === "passed" ? "✓" : toRoman(lesson.ord)}
              </span>
              {/* 15px, not `body`: at 280px with a 28px numeral, 16px wraps
                  three-line titles badly. */}
              <span className={cn("text-[15px] leading-[1.4]", LABEL[state])}>
                {lesson.title}
              </span>
              <span className="sr-only">
                {state === "passed"
                  ? "passed"
                  : state === "active"
                    ? "current lesson"
                    : "locked"}
              </span>
            </li>
          );
        })}
      </ol>

      <ProgressMeter
        total={lessons.length}
        passed={passedOrds.length}
        className="mt-auto"
      />

      {footer}
    </nav>
  );
}
