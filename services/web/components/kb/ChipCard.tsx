"use client";

import { Check, Trash2, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Chip, ChipRegister } from "@/lib/types";

// NEW_DESIGN.md §6.2 — the card the redesign exists for.
//
// The old one was 284px wide inside a 2-up grid in a 65%-width editor column.
// The question input clipped mid-word and the three register chips wrapped to
// two lines. It is now 472px at 2-up and 976px at 1-up, and at 1-up it splits
// into a two-column interior so the extra width buys legibility rather than
// just longer line lengths.
//
// The live state is three signals, one of them non-chromatic: a `--live-wash`
// fill, a `--live-hairline` border, and the words "Live to recruiters". Orange
// alone never carries meaning here.

const REGISTERS: { value: ChipRegister; label: string; hint: string }[] = [
  { value: "skeptical", label: "Skeptical", hint: "Doubts the depth" },
  { value: "narrative", label: "Narrative", hint: "Asks to be walked through" },
  { value: "blunt", label: "Blunt", hint: "Asks the uncomfortable thing" },
];

function FieldBlock({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="type-label text-ink-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

export function ChipCard({
  chip,
  index,
  unresolved,
  selectionFull,
  rephraseState,
  onChange,
  onDelete,
  onToggle,
  onRephrase,
}: {
  chip: Chip;
  index: number;
  /** `kb_section` names a section that isn't there. See lib/refs.ts. */
  unresolved?: boolean;
  /** Three are already chosen, so this one can't be added without dropping one. */
  selectionFull?: boolean;
  rephraseState?: "idle" | "working";
  onChange: (patch: Partial<Chip>) => void;
  onDelete: () => void;
  onToggle: () => void;
  onRephrase: (register: ChipRegister) => void;
}) {
  const working = rephraseState === "working";
  const cannotSelect = !chip.selected && selectionFull;
  const next = nextRegister(chip.register);
  const headingId = `chip-${index}-heading`;
  const questionId = `chip-${index}-question`;
  const sourceId = `chip-${index}-source`;
  const reasonId = `chip-${index}-reason`;

  return (
    <article
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-5 p-6",
        chip.selected ? "card-live" : "card-surface"
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <p id={headingId} className="type-caption text-ink-subtle">
          Question {index + 1}
        </p>
        {chip.selected && (
          <p className="type-label flex items-center gap-1.5 text-ink">
            <Check className="size-3.5 text-live" aria-hidden />
            Live to recruiters
          </p>
        )}
      </header>

      {/* Two columns once there is room for two. Below `2xl` the card is the
          full width of the panel, so the split is what stops that width turning
          into one very long line. */}
      <div className="grid gap-5 min-[1180px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <FieldBlock label="What they type" htmlFor={questionId}>
            {/* type-subhead, and never narrower than its container: the whole
                point of the card is reading the question. */}
            <Input
              id={questionId}
              value={chip.text}
              onChange={(event) => onChange({ text: event.target.value })}
              className="type-subhead h-auto py-2.5"
            />
          </FieldBlock>

          <FieldBlock label="Register">
            <div className="flex flex-wrap gap-1.5">
              {REGISTERS.map((register) => {
                const active = chip.register === register.value;
                return (
                  <button
                    key={register.value}
                    type="button"
                    title={register.hint}
                    aria-pressed={active}
                    onClick={() => onChange({ register: register.value })}
                    className={cn(
                      "type-body-sm rounded-sm border px-3 py-1.5",
                      "transition-colors duration-120 ease-out",
                      active
                        ? "border-ink bg-ink text-on-ink"
                        : "border-hairline bg-surface text-ink-muted hover:border-ink-subtle hover:text-ink"
                    )}
                  >
                    {register.label}
                  </button>
                );
              })}
            </div>
          </FieldBlock>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <FieldBlock label="Why this one" htmlFor={reasonId}>
            {/* The candidate's private note about what the question signals and
                what it costs. Never leaves the owner's copy. */}
            <Textarea
              id={reasonId}
              value={chip.why_it_lands}
              onChange={(event) => onChange({ why_it_lands: event.target.value })}
              rows={3}
              placeholder="What it signals, and what it costs."
              className="type-body-sm bg-surface-sunk text-ink-muted"
            />
          </FieldBlock>

          <FieldBlock label="Answers from" htmlFor={sourceId}>
            <Input
              id={sourceId}
              value={chip.kb_section}
              onChange={(event) => onChange({ kb_section: event.target.value })}
              placeholder="agoda/psp-routing#circuit-breakers"
              aria-invalid={unresolved}
              aria-describedby={unresolved ? `${sourceId}-error` : undefined}
              className="type-mono"
            />
            {unresolved && (
              <p id={`${sourceId}-error`} className="type-body-sm text-danger">
                This section is not in your knowledge base.
              </p>
            )}
          </FieldBlock>
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-hairline-soft pt-4">
        <Button
          variant={chip.selected ? "primary" : "secondary"}
          size="sm"
          disabled={cannotSelect}
          onClick={onToggle}
          title={
            cannotSelect ? "Three are already chosen. Drop one first." : undefined
          }
        >
          {chip.selected ? "On your front page" : "Use this one"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={working}
          onClick={() => onRephrase(next)}
        >
          <Wand2 aria-hidden />
          {working ? "Rewriting" : `Make it ${next}`}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} className="ml-auto">
          <Trash2 aria-hidden />
          Delete
        </Button>
      </footer>
    </article>
  );
}

/**
 * Rephrasing cycles the register rather than asking the model to surprise you.
 * "Say this another way" is a coin flip; "make this blunter" is a decision the
 * candidate can judge.
 */
function nextRegister(current: ChipRegister): ChipRegister {
  const order: ChipRegister[] = ["narrative", "skeptical", "blunt"];
  return order[(order.indexOf(current) + 1) % order.length];
}

/**
 * The public form: text only, exactly as a recruiter taps it. There is nothing
 * to reveal here because `why_it_lands` and `kb_section` never reached the
 * browser, and the orange is honest because this chip genuinely is public.
 */
export function PublicChip({ text }: { text: string }) {
  return (
    <p className="type-body rounded-md border border-live-hairline bg-live-wash px-4 py-2.5 text-ink">
      {text}
    </p>
  );
}
