"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Position } from "@/lib/types";

// DESIGN.md §4.5 — the position card is the product; it gets the most care.
// Three zones, three type treatments: claim in `title` on a pink highlighter,
// `because` in Newsreader at the reading size, `pushback` in a pink-wash box.
//
// In edit mode the highlighter becomes a pink-filled field rather than an
// inline span — a textarea can't carry `box-decoration-break`, and pink is a
// surface either way, so black-on-pink stays at 10.96:1.

function Zone({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="type-meta text-ink-muted">{label}</p>
      {children}
    </div>
  );
}

export function PositionCard({
  position,
  index,
  unanchored,
  onChange,
  onDelete,
  onSoften,
  softenState,
}: {
  position: Position;
  index: number;
  /** The quote could not be found in the source — see lib/quotes.ts. */
  unanchored?: boolean;
  onChange: (patch: Partial<Position>) => void;
  onDelete: () => void;
  onSoften: () => void;
  softenState?: "idle" | "working" | "unavailable";
}) {
  const [kept, setKept] = useState(false);

  return (
    <article className="flex flex-col gap-4 border-[3px] border-ink bg-paper p-6">
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-meta text-ink-muted">Stance {index + 1}</p>
        {kept && (
          <p className="type-meta border-2 border-ink bg-ink px-2 py-0.5 text-paper">
            ✓ Kept
          </p>
        )}
      </div>

      <Zone label="Claim">
        <Textarea
          aria-label={`Claim for stance ${index + 1}`}
          value={position.claim}
          onChange={(event) => onChange({ claim: event.target.value })}
          rows={2}
          className="type-title bg-pink"
        />
      </Zone>

      <Zone label="Because">
        <Textarea
          aria-label={`Reasoning for stance ${index + 1}`}
          value={position.because}
          onChange={(event) => onChange({ because: event.target.value })}
          rows={3}
          className="type-body-l"
        />
      </Zone>

      <Zone label="When they push back">
        <Textarea
          aria-label={`Pushback for stance ${index + 1}`}
          value={position.pushback}
          onChange={(event) => onChange({ pushback: event.target.value })}
          rows={3}
          className="type-body-l border-[1.5px] bg-pink-wash italic"
        />
      </Zone>

      {position.quote && (
        <details className="border-[1.5px] border-ink">
          <summary className="type-meta cursor-pointer px-3 py-2 hover:bg-pink">
            ▸ Source
            {unanchored && " · not found in your material"}
          </summary>
          <blockquote
            className={cn(
              "type-body-l border-t-[1.5px] border-ink px-3 py-3 italic",
              unanchored ? "bg-paper" : "bg-paper-tint"
            )}
          >
            {position.quote}
          </blockquote>
        </details>
      )}

      {unanchored && (
        // §2 — a warning is carried by weight and pattern, not by hue.
        <div className="flex items-stretch border-2 border-ink">
          <span aria-hidden className="pat-hatch w-2.5 shrink-0" />
          <p className="type-body-s px-3 py-2 text-ink">
            This quote isn&apos;t in the material you uploaded. Check the stance
            before you publish it.
          </p>
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2 border-t-2 border-ink pt-4">
        <Button
          variant={kept ? "primary" : "secondary"}
          size="sm"
          onClick={() => setKept((value) => !value)}
        >
          Keep
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={softenState === "working"}
          onClick={onSoften}
        >
          {softenState === "working" ? "Softening…" : "Soften"}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="ml-auto"
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
    </article>
  );
}

/**
 * The variant a stranger sees on /c/:slug, and what the review screen's preview
 * panel renders. `because` is not hidden — it was never sent. See
 * lib/serialize.ts and DESIGN.md §4.5: a CSS blur is one devtools inspection
 * away from giving the product away.
 */
export function LockedPositionCard({ claim }: { claim: string }) {
  return (
    <article className="flex flex-col gap-4 border-[3px] border-ink bg-paper p-5">
      <p className="type-meta text-ink-muted">Claim</p>
      <p className="type-title">
        <span className="hl">{claim}</span>
      </p>
      <p className="type-meta text-ink-muted">Because</p>
      <div className="pat-halftone grid h-28 place-items-center border-[1.5px] border-ink-faint">
        <span className="type-label flex items-center gap-2 rounded-pill bg-ink px-4 py-2 text-paper">
          <Lock className="size-3.5" aria-hidden />
          Unlock
        </span>
      </div>
    </article>
  );
}
