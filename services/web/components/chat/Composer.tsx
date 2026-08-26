import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * DESIGN.md §4.10 — the composer is the exception to the input rules: 3px
 * border, 56px min height, auto-growing, with `[SKIP AHEAD]` and `[I'M LOST]`
 * pinned to its right edge.
 *
 * Journey 1 only ever renders it disabled, inside the preview. The buttons are
 * here because the Specialist should see what the student's controls are, and
 * because Journey 3 inherits this component rather than rebuilding it.
 */
export function Composer({
  placeholder = "Tell her what you actually charge…",
  disabled,
}: {
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="measure-read flex items-end gap-3 border-[3px] border-ink p-3">
      <Textarea
        aria-label="Message"
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        className="min-h-14 border-0 px-0 py-2 disabled:border-0"
      />
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" size="sm" disabled={disabled}>
          Skip ahead
        </Button>
        <Button variant="secondary" size="sm" disabled={disabled}>
          I&apos;m lost
        </Button>
      </div>
    </div>
  );
}
