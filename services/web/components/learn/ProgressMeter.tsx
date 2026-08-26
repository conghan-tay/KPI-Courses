import { cn } from "@/lib/utils";

/**
 * DESIGN.md §4.9 — discrete blocks, not a bar. One cell per lesson, 2px black
 * track, filled pink. When mark_progress fires the next block fills in a single
 * `steps(1)` 140ms snap: a discrete snap reads as an achievement, a smooth fill
 * reads as loading. It is the only reward animation in the product.
 */
export function ProgressMeter({
  total,
  passed,
  className,
}: {
  total: number;
  passed: number;
  className?: string;
}) {
  const percent = total === 0 ? 0 : Math.round((passed / total) * 100);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between">
        <span className="type-meta">Progress</span>
        <span className="type-meta">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={passed}
        aria-label={`${passed} of ${total} lessons passed`}
        className="flex h-[22px] border-2 border-ink"
      >
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cn(
              "flex-1 border-r-[1.5px] border-ink last:border-r-0",
              "transition-colors duration-[140ms] ease-[steps(1)]",
              index < passed && "bg-pink"
            )}
          />
        ))}
      </div>
    </div>
  );
}
