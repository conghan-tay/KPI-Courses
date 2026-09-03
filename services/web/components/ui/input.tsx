import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

// NEW_DESIGN.md §6.6 — white fill, 1px hairline, 8px radius, 10px/14px padding.
// Focus is the global charcoal ring (globals.css) because focus is not public;
// orange is reserved for what a recruiter sees. Invalid switches the border to
// danger and <Field> renders the message below.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "type-body w-full min-w-0 rounded-md border border-hairline bg-surface px-3.5 py-2.5 text-ink",
        "placeholder:text-ink-subtle",
        "transition-colors duration-120 ease-out hover:border-ink-subtle",
        "aria-invalid:border-danger",
        "disabled:pointer-events-none disabled:bg-surface-sunk disabled:text-ink-faint disabled:border-hairline-soft",
        className
      )}
      {...props}
    />
  );
}

export { Input };
