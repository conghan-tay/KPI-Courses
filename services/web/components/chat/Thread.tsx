import { RisoPortrait } from "@/components/course/RisoPortrait";
import { cn } from "@/lib/utils";

// DESIGN.md §4.6 — asymmetric by design. Do not use symmetric left/right
// bubbles: the Specialist is publishing and the Seeker is interjecting, and the
// geometry should say so. His words get the page; hers get a box.
//
// Turn spacing is 32px between speakers, 12px within one speaker's run.

export function Thread({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("measure-read flex flex-col gap-8", className)}>
      {children}
    </div>
  );
}

/** No border, no fill, full reading column, name in meta caps above. */
export function SpecialistTurn({
  name,
  initials,
  children,
  streaming,
}: {
  name: string;
  initials: string;
  children: React.ReactNode;
  streaming?: boolean;
}) {
  return (
    <div className="flex gap-3.5">
      <RisoPortrait name={name} initials={initials} size="sm" />
      <div className="flex flex-1 flex-col gap-2">
        <p className="type-meta text-ink-muted">{name}</p>
        <div className="type-body-l">
          {children}
          {streaming && <span aria-hidden className="stream-caret ml-1" />}
        </div>
      </div>
    </div>
  );
}

/** 2px border, square, paper-tint fill, capped at 44ch, right-aligned. */
export function SeekerTurn({ children }: { children: React.ReactNode }) {
  return (
    <div className="type-body max-w-[44ch] self-end border-2 border-ink bg-paper-tint px-4 py-3">
      {children}
    </div>
  );
}
