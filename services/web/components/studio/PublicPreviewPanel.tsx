"use client";

import { useEffect, useState } from "react";

import { PublicChip } from "@/components/kb/ChipCard";
import { RisoPortrait } from "@/components/kb/RisoPortrait";
import { getPublicKB } from "@/lib/api-client";
import type { PublicKB } from "@/lib/types";

/**
 * DESIGN.md §5.3 gives /studio/:id an 8/4 editor / live-preview split. This is
 * the 4: what a stranger sees.
 *
 * It deliberately re-fetches through `?audience=public` rather than rendering
 * the knowledge base already in memory. The panel therefore *proves* the
 * withholding rule instead of imitating it — there is no quiz in this
 * component's props to leak, because the server never sent one.
 *
 * That matters more here than a paywall would. The quiz gates booking twenty
 * minutes of the candidate's real time; a leaked `correct_index` makes it a
 * formality.
 */
export function PublicPreviewPanel({
  kbId,
  /** Changes when a save lands, which is when the panel should re-read. */
  refreshKey,
}: {
  kbId: string;
  refreshKey: string;
}) {
  const [knowledgeBase, setKnowledgeBase] = useState<PublicKB | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPublicKB(kbId)
      .then((next) => !cancelled && setKnowledgeBase(next))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [kbId, refreshKey]);

  return (
    <aside className="flex flex-col gap-4">
      <div className="border-b-[3px] border-ink pb-2">
        <p className="type-label">What a stranger sees</p>
        <p className="type-body-s mt-1 text-ink-muted">
          Your quiz answers never reach a browser.
        </p>
      </div>

      {knowledgeBase === null ? (
        <div
          className="pat-halftone h-64 border-2 border-ink"
          aria-label="Loading preview"
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 border-2 border-ink p-4">
            <RisoPortrait
              name={knowledgeBase.candidate_name}
              initials={initialsOf(knowledgeBase.candidate_name)}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="type-title">{knowledgeBase.title}</p>
              <p className="type-body-s mt-1 text-ink-muted">
                {knowledgeBase.tagline}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-2 border-ink p-4">
            <p className="type-meta text-ink-muted">Pre-roll</p>
            <p className="type-title">{knowledgeBase.pre_roll.headline}</p>
            <ul className="flex flex-col gap-1">
              {knowledgeBase.pre_roll.bullets.map((bullet, index) => (
                <li key={index} className="type-body-s flex gap-2">
                  <span aria-hidden>▸</span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col items-start gap-2">
            {knowledgeBase.chips.map((chip, index) => (
              <PublicChip key={index} text={chip.text} />
            ))}
          </div>

          {knowledgeBase.chips.length === 0 && (
            <p className="type-body-s text-ink-muted">
              No questions chosen, so the page opens with nothing to tap.
            </p>
          )}

          <p className="type-meta text-ink-muted">
            {knowledgeBase.sections.length} sections listed by title. Bodies stay
            behind the hour.
          </p>
        </div>
      )}
    </aside>
  );
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
