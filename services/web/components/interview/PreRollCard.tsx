import { cn } from "@/lib/utils";
import type { PreRoll } from "@/lib/types";

/**
 * docs/productDocs/TheReverseInterview/pre_roll_wireframe.txt, built.
 *
 * A 3px black frame, a headline in caps, four bullets of what's loaded, the
 * price line, and one button. The price is static copy rather than data:
 * POC_UserJourney.md §0 fixes it at the platform level, so a model has no
 * business inventing it per candidate.
 */
export const PRICE_LINE = "$3.00 + model cost. Meter visible throughout.";

export function PreRollCard({
  preRoll,
  disabled = false,
  className,
}: {
  preRoll: PreRoll;
  /** True in every preview: the hour is Journey 2 and does not exist yet. */
  disabled?: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn("card-surface flex flex-col gap-5 p-6", className)}
    >
      <h2 className="type-headline">
        {preRoll.headline || "Sixty minutes. Starts when you hit send."}
      </h2>

      <div className="flex flex-col gap-2">
        <p className="type-caption text-ink-muted">What&apos;s loaded</p>
        <ul className="flex flex-col gap-1.5">
          {preRoll.bullets.map((bullet, index) => (
            <li key={index} className="type-body-l flex gap-2">
              <span aria-hidden className="select-none">
                ▸
              </span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
        {preRoll.bullets.length === 0 && (
          <p className="type-body-sm text-ink-muted">
            Nothing here yet. Four lines saying what a recruiter will actually
            get is what makes the hour worth starting.
          </p>
        )}
      </div>

      <p className="type-caption border-t border-hairline-soft pt-4">{PRICE_LINE}</p>

      <button
        type="button"
        disabled={disabled}
        className={cn(
          "type-label self-start rounded-full border border-hairline px-6 py-3",
          disabled
            ? "cursor-not-allowed border-hairline-soft text-ink-faint"
            : "bg-ink text-on-ink"
        )}
      >
        Start my hour
      </button>
    </section>
  );
}
