"use client";

/**
 * DESIGN.md §4.14 — no spinners, no skeleton shimmer. A loading region is
 * filled with halftone and carries a `meta` line of streamed status, and no
 * progress percentage we can't honour: a single LLM call has no honest
 * midpoint.
 *
 * The status log is `aria-live="polite"` so a screen reader hears the same
 * thing a sighted user watches.
 */
export function IngestPanel({ statuses }: { statuses: string[] }) {
  const latest = statuses.at(-1) ?? "Starting…";
  const history = statuses.slice(0, -1).slice(-4);

  return (
    <div className="card-surface grid min-h-50 place-items-center p-6">
      <div className="flex w-full max-w-[52ch] flex-col gap-3 border border-hairline bg-surface px-6 py-5">
        <p className="type-title">Reading everything you gave me.</p>
        <p className="type-body-sm text-ink-muted">
          Thirty to sixty seconds. Don&apos;t close the tab. If it fails, the
          draft survives and you can retry.
        </p>

        <div aria-live="polite" aria-atomic="false" className="mt-2 flex flex-col gap-1">
          {history.map((status, index) => (
            <p key={`${status}-${index}`} className="type-caption text-ink-faint">
              {status}
            </p>
          ))}
          <p className="type-caption text-ink">
            {latest}
            <span aria-hidden className="stream-caret ml-1" />
          </p>
        </div>
      </div>
    </div>
  );
}
