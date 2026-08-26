import { cn } from "@/lib/utils";

/**
 * DESIGN.md §5.4 — two blocks that don't belong together are separated with
 * ink, not distance. Every section on a working screen opens with a heading on
 * a 3px rule.
 */
export function SectionHead({
  title,
  note,
  actions,
  className,
}: {
  title: string;
  note?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-7 flex flex-wrap items-baseline gap-4 border-b-[3px] border-ink pb-2.5",
        className
      )}
    >
      <h2 className="type-display-m">{title}</h2>
      {note && <span className="type-meta text-ink-muted">{note}</span>}
      {actions && <div className="ml-auto flex items-center gap-3">{actions}</div>}
    </div>
  );
}
