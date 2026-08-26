import { cn } from "@/lib/utils";

/**
 * DESIGN.md §2 — "Warning / thin result: 3px ink border + hatch-filled left
 * gutter, black text. No colour change." There is no amber in this system, so
 * a warning is carried by weight and pattern instead of hue.
 *
 * `alert` is the escape hatch, and it is only for hard failure: an ingestion
 * that died, a value that cannot be saved.
 */
export function Notice({
  tone = "warning",
  label,
  children,
  actions,
  className,
}: {
  tone?: "warning" | "alert";
  label: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const alert = tone === "alert";

  return (
    <div
      role={alert ? "alert" : undefined}
      className={cn(
        "flex items-stretch border-[3px]",
        alert ? "border-alert" : "border-ink",
        className
      )}
    >
      <div
        aria-hidden
        className={cn("w-3 shrink-0", alert ? "pat-hatch-alert" : "pat-hatch")}
      />
      <div className="flex flex-1 flex-col gap-3 bg-paper px-5 py-4">
        <p className={cn("type-meta", alert ? "text-alert" : "text-ink-muted")}>
          {label}
        </p>
        <div className="type-body measure-ui text-ink">{children}</div>
        {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
      </div>
    </div>
  );
}
