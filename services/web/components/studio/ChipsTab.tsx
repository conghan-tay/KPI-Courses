"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { ChipCard } from "@/components/kb/ChipCard";
import { Notice } from "@/components/riso/Notice";
import { ApiRequestError, rephraseChip } from "@/lib/api-client";
import { countSelected, deleteChip, emptyChip, toggleChip, updateChip } from "@/lib/reducers";
import { TARGET_CHIPS } from "@/lib/refs";
import { SELECTED_CHIP_COUNT } from "@/lib/types";
import type { Chip, ChipRegister, KnowledgeBase } from "@/lib/types";

/**
 * The default tab, and that is the reframe.
 *
 * It tells the candidate: these are the eight questions a recruiter types first,
 * and you are choosing which three represent you. That is the decision they will
 * actually want to make, and it is the one that decides what a stranger sees.
 */
export function ChipsTab({
  knowledgeBase,
  unresolved,
  onChange,
  onReplace,
}: {
  knowledgeBase: KnowledgeBase;
  /** Indexes whose `kb_section` names nothing — see lib/refs.ts. */
  unresolved: number[];
  onChange: (chips: Chip[]) => void;
  onReplace: (knowledgeBase: KnowledgeBase) => void;
}) {
  const [rephrasing, setRephrasing] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const chips = knowledgeBase.chips;
  const selected = countSelected(chips);
  const thin = chips.length < TARGET_CHIPS;

  async function rephrase(index: number, register: ChipRegister) {
    setRephrasing(index);
    setNote(null);
    try {
      onReplace(await rephraseChip(knowledgeBase.id, index, register));
    } catch (error) {
      setNote(
        error instanceof ApiRequestError
          ? error.detail.message
          : "The rewrite failed."
      );
    } finally {
      setRephrasing(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {chips.length === 0 ? (
        <Notice label="No questions yet">
          <p>
            We didn&apos;t find enough in your material to guess what a recruiter
            would ask first. Write three yourself — they&apos;re the first thing
            anyone sees.
          </p>
        </Notice>
      ) : (
        <p className="type-body-l measure-read">
          These are the {chips.length} questions a recruiter would type first.
          Pick {SELECTED_CHIP_COUNT} for your front page — the rest stay yours.
        </p>
      )}

      {/* The counter is the whole interaction. Publishing needs exactly three,
          so it says where you stand rather than waiting to refuse at the end. */}
      {chips.length > 0 && (
        <div
          className={`type-label flex items-center gap-3 border-2 border-ink px-4 py-3 ${
            selected === SELECTED_CHIP_COUNT ? "bg-pink" : "bg-paper"
          }`}
          aria-live="polite"
        >
          <span className="font-mono">
            {selected} / {SELECTED_CHIP_COUNT}
          </span>
          <span>
            {selected === SELECTED_CHIP_COUNT
              ? "chosen — that's your front page"
              : selected < SELECTED_CHIP_COUNT
                ? `chosen — pick ${SELECTED_CHIP_COUNT - selected} more to publish`
                : "chosen — drop one to publish"}
          </span>
        </div>
      )}

      {thin && chips.length > 0 && (
        <Notice label={`Only ${chips.length} questions`}>
          We aim for {TARGET_CHIPS} so there is something to choose between. You
          can still publish — three is all the front page shows — but a thin set
          means the pipeline found less in your material than it wanted to.
        </Notice>
      )}

      {note && <Notice label="Rewrite">{note}</Notice>}

      <div className="grid gap-6 lg:grid-cols-2">
        {chips.map((chip, index) => (
          <ChipCard
            key={index}
            chip={chip}
            index={index}
            unresolved={unresolved.includes(index)}
            selectionFull={selected >= SELECTED_CHIP_COUNT}
            rephraseState={rephrasing === index ? "working" : "idle"}
            onChange={(patch) => onChange(updateChip(chips, index, patch))}
            onDelete={() => onChange(deleteChip(chips, index))}
            onToggle={() => onChange(toggleChip(chips, index))}
            onRephrase={(register) => void rephrase(index, register)}
          />
        ))}

        <button
          type="button"
          onClick={() => onChange([...chips, emptyChip()])}
          className="type-label flex min-h-40 items-center justify-center gap-2 border-[3px] border-dashed border-ink bg-paper p-6 text-ink hover:bg-pink"
        >
          <Plus className="size-4" aria-hidden />
          Add a question
        </button>
      </div>
    </div>
  );
}
