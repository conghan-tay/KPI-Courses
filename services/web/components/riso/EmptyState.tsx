import { cn } from "@/lib/utils";

/**
 * DESIGN.md §4.14 — empty states are a bordered box on halftone with one title
 * line and one action. Copy is blunt, never apologetic: "Nothing here yet. Build one."
 *
 * The words never sit directly on the halftone. The dots are 30% black and they
 * destroy small type, so the ground stays a ground and the copy floats in a
 * paper box on top of it.
 */
export function EmptyState({
  title,
  note,
  action,
  className,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pat-halftone grid place-items-center border-2 border-ink p-11",
        className
      )}
    >
      <div className="flex flex-col items-start gap-3.5 border-2 border-ink bg-paper px-6 py-5">
        <p className="type-title">{title}</p>
        {note && <p className="type-body-s measure-ui text-ink-muted">{note}</p>}
        {action}
      </div>
    </div>
  );
}
