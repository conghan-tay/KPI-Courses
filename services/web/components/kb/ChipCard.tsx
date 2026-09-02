"use client";

import { Check, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Chip, ChipRegister } from "@/lib/types";

// The chip card is the product of Journey 1: eight of these are generated and
// the candidate picks three for their front page. DESIGN.md's card rules apply —
// square container, 3px black border, pill actions, state carried by fill and
// pattern rather than hue.
//
// A selected chip is filled pink and *also* gains a black tick, so the three
// that go public are distinguishable in greyscale and in a screenshot.

const REGISTERS: { value: ChipRegister; label: string; hint: string }[] = [
  { value: "skeptical", label: "Skeptical", hint: "Doubts the depth" },
  { value: "narrative", label: "Narrative", hint: "Asks to be walked through" },
  { value: "blunt", label: "Blunt", hint: "Asks the uncomfortable thing" },
];

function Zone({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="type-meta text-ink-muted">{label}</p>
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
  /** `kb_section` names a section that isn't there — see lib/refs.ts. */
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

  return (
    <article
      className={cn(
        "flex flex-col gap-4 border-[3px] border-ink p-6",
        chip.selected ? "bg-pink" : "bg-paper"
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-meta text-ink-muted">Question {index + 1}</p>
        {chip.selected && (
          <p className="type-meta flex items-center gap-1 border-2 border-ink bg-ink px-2 py-0.5 text-paper">
            <Check className="size-3" aria-hidden />
            On your front page
          </p>
        )}
      </div>

      <Zone label="What they type">
        <Input
          aria-label={`Question ${index + 1}`}
          value={chip.text}
          onChange={(event) => onChange({ text: event.target.value })}
          className="type-title bg-paper"
        />
      </Zone>

      <Zone label="Register">
        <div className="flex flex-wrap gap-2">
          {REGISTERS.map((register) => (
            <button
              key={register.value}
              type="button"
              title={register.hint}
              aria-pressed={chip.register === register.value}
              onClick={() => onChange({ register: register.value })}
              className={cn(
                "type-label rounded-full border-2 border-ink px-3 py-1",
                chip.register === register.value
                  ? "bg-ink text-paper"
                  : "bg-paper text-ink hover:bg-pink"
              )}
            >
              {register.label}
            </button>
          ))}
        </div>
      </Zone>

      {chip.why_it_lands && (
        <Zone label="Why this one">
          {/* The candidate's own note about what the question signals and what
              it costs. Never leaves the owner's copy. */}
          <Textarea
            aria-label={`Why question ${index + 1} lands`}
            value={chip.why_it_lands}
            onChange={(event) => onChange({ why_it_lands: event.target.value })}
            rows={3}
            className="type-body-l bg-paper italic"
          />
        </Zone>
      )}

      <Zone label="Answers from">
        <Input
          aria-label={`Source section for question ${index + 1}`}
          value={chip.kb_section}
          onChange={(event) => onChange({ kb_section: event.target.value })}
          placeholder="agoda/psp-routing#circuit-breakers"
          className="font-mono text-[13px] bg-paper"
        />
      </Zone>

      {unresolved && (
        // DESIGN.md §2 — a warning is carried by weight and pattern, not by hue.
        <div className="flex items-stretch border-2 border-ink bg-paper">
          <span aria-hidden className="pat-hatch w-2.5 shrink-0" />
          <p className="type-body-s px-3 py-2 text-ink">
            This points at a section that isn&apos;t in your knowledge base. The
            agent will have nothing to answer it from.
          </p>
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2 border-t-2 border-ink pt-4">
        <Button
          variant={chip.selected ? "primary" : "secondary"}
          size="sm"
          disabled={cannotSelect}
          onClick={onToggle}
          title={
            cannotSelect
              ? "Three are already chosen. Drop one first."
              : undefined
          }
        >
          {chip.selected ? "Selected" : "Use this one"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={working}
          onClick={() => onRephrase(nextRegister(chip.register))}
        >
          <Wand2 className="size-3.5" aria-hidden />
          {working ? "Rewriting…" : `Make it ${nextRegister(chip.register)}`}
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </article>
  );
}

/**
 * Rephrasing cycles the register rather than asking the model to surprise you.
 * "Say this another way" produces a coin flip; "make this blunter" produces a
 * decision the candidate can judge.
 */
function nextRegister(current: ChipRegister): ChipRegister {
  const order: ChipRegister[] = ["narrative", "skeptical", "blunt"];
  return order[(order.indexOf(current) + 1) % order.length];
}

/**
 * The public form: text only, on a pink block, exactly as a recruiter taps it.
 * There is nothing to reveal here — `why_it_lands` and `kb_section` never
 * reached the browser, because ToPublic in the gateway did not send them.
 */
export function PublicChip({ text }: { text: string }) {
  return (
    <p className="type-body-l rounded-full border-2 border-ink bg-pink px-4 py-2 text-ink">
      {text}
    </p>
  );
}
