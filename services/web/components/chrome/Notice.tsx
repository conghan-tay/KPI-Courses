import { cn } from "@/lib/utils";

/**
 * NEW_DESIGN.md §6.7 — a sunk card with a hairline. No left gutter stripe, no
 * hatch pattern: a warning that needs a pattern to be noticed is a warning in
 * the wrong place, and the stripe cost horizontal budget on every notice.
 *
 * `danger` is the escape hatch, and it is only for hard failure: an ingestion
 * that died, a gate that cannot run, a value that cannot be saved.
 */
export function Notice({
  tone = "warning",
  label,
  children,
  actions,
  className,
}: {
  tone?: "warning" | "danger";
  label: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const danger = tone === "danger";

  return (
    <div
      role={danger ? "alert" : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-5",
        danger
          ? "border-danger/30 bg-danger-wash"
          : "border-hairline bg-surface-sunk",
        className
      )}
    >
      <p className={cn("type-label", danger ? "text-danger" : "text-ink")}>
        {label}
      </p>
      <div className="type-body-sm measure-ui text-ink-muted">{children}</div>
      {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
    </div>
  );
}
