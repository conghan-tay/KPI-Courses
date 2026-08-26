import * as React from "react";

import { cn } from "@/lib/utils";

// DESIGN.md §4.10 — the same square / 2px / paper treatment as Input.
// `field-sizing-content` grows the box with its content so no resize handle
// fights the square frame.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "type-body field-sizing-content w-full resize-none rounded-none border-2 border-ink bg-paper px-4 py-3 text-ink",
        "placeholder:text-ink-muted",
        "aria-invalid:border-alert",
        "disabled:border-ink-faint disabled:text-ink-faint",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
