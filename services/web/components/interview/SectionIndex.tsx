import { toRoman } from "@/lib/text";
import { cn } from "@/lib/utils";
import { sectionId } from "@/lib/types";
import type { Section } from "@/lib/types";

// DESIGN.md §4.8 — roman numerals in outlined circles down a 280px rail on
// paper-tint, separated from the content by a 3px rule. What used to be a
// syllabus is now the index of the knowledge base: what's loaded, in the order
// a stranger should read it.
//
// State is never carried by hue alone. `cited` — a section some chip or quiz
// item points at — is a filled black disc; everything else is an outline. The
// rail stays readable in greyscale and to a colourblind reader, which is the
// point of doing it this way rather than with a colour.

export function SectionIndex({
  sections,
  citedIds = [],
  note,
  footer,
  className,
}: {
  sections: Section[];
  /** Section ids something references. Rendered filled rather than outlined. */
  citedIds?: string[];
  note?: string;
  footer?: React.ReactNode;
  className?: string;
}) {
  const cited = new Set(citedIds);

  return (
    <nav
      aria-label="Knowledge base"
      className={cn(
        "flex w-[280px] shrink-0 flex-col gap-5 border-r-[3px] border-ink bg-paper-tint p-5",
        className
      )}
    >
      {note && <p className="type-meta text-ink-muted">{note}</p>}

      <ol className="flex flex-col">
        {sections.map((section) => {
          const isCited = cited.has(sectionId(section.path, section.anchor));
          return (
            <li key={section.ord} className="flex items-center gap-3 py-[7px]">
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border-2 border-ink",
                  "font-mono text-[10px] leading-none font-medium",
                  isCited ? "bg-ink text-paper" : "bg-paper text-ink"
                )}
              >
                {toRoman(section.ord)}
              </span>
              {/* 15px, not `body`: at 280px with a 28px numeral, 16px wraps
                  three-line titles badly. */}
              <span
                className={cn(
                  "text-[15px] leading-[1.4] text-ink",
                  isCited ? "font-bold" : "font-normal"
                )}
              >
                {section.title}
              </span>
              {isCited && (
                <span className="sr-only">referenced by a question</span>
              )}
            </li>
          );
        })}
      </ol>

      {sections.length === 0 && (
        <p className="type-body-s text-ink-muted">
          Nothing loaded yet.
        </p>
      )}

      <div className="mt-auto flex flex-col gap-3">{footer}</div>
    </nav>
  );
}
