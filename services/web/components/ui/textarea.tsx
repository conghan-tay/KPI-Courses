import * as React from "react";

import { cn } from "@/lib/utils";

// NEW_DESIGN.md §6.6 — the same treatment as Input. `field-sizing-content` grows
// the box with its content so a long answer is never clipped and no resize
// handle fights the card.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "type-body field-sizing-content w-full resize-none rounded-md border border-hairline bg-surface px-3.5 py-2.5 text-ink",
        "placeholder:text-ink-subtle",
        "transition-colors duration-120 ease-out hover:border-ink-subtle",
        "aria-invalid:border-danger",
        "disabled:bg-surface-sunk disabled:text-ink-faint disabled:border-hairline-soft",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
