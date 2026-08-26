import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

// DESIGN.md §4.10 — square, 2px ink border, paper fill, 12px/16px padding.
// Focus is the global black ring with a paper gap (globals.css), never a pink
// glow and never a border-colour change. Invalid switches the border to alert;
// the hatch gutter and the message come from <Field> in components/form/Field.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "type-body w-full min-w-0 rounded-none border-2 border-ink bg-paper px-4 py-3 text-ink",
        "placeholder:text-ink-muted",
        "aria-invalid:border-alert",
        "disabled:pointer-events-none disabled:border-ink-faint disabled:text-ink-faint",
        className
      )}
      {...props}
    />
  );
}

export { Input };
