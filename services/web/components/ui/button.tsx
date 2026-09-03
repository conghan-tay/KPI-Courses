import Link from "next/link";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// NEW_DESIGN.md §6.1 — 8px radius, 15/500 label, one line always. No pills.
// Tactility is a 1px downward translate over 120ms: it confirms the click landed
// and does nothing else. There is no lift, no shadow toggle, no stepped easing.
const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md",
    "type-button whitespace-nowrap select-none cursor-pointer",
    "transition-[background-color,color,border-color,transform] duration-120 ease-out",
    "active:translate-y-px",
    "disabled:pointer-events-none disabled:bg-surface-sunk disabled:text-ink-faint disabled:border-hairline-soft",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
  ),
  {
    variants: {
      variant: {
        primary: "border border-ink bg-ink text-on-ink hover:bg-black",
        // §6.1 — the publish action, and nothing else. White on #ff5600 is
        // 3.19:1, which is below AA at 15px and above the 3:1 large-text
        // threshold at 16px/600. The size bump is a contrast requirement, not
        // a style choice.
        live: "border border-live bg-live text-on-ink text-[16px] font-semibold hover:bg-[#e64d00]",
        secondary:
          "border border-hairline bg-surface text-ink hover:bg-surface-sunk",
        ghost:
          "border border-transparent bg-transparent text-ink-muted hover:bg-surface-sunk hover:text-ink disabled:bg-transparent disabled:border-transparent",
        danger:
          "border border-danger bg-surface text-danger hover:bg-danger-wash",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        // 40px default. 44px is the touch floor, which `md` clears once the
        // tablet breakpoint bumps it — never use `sm` for a primary action.
        md: "h-10 px-[18px] py-2.5 max-md:h-11",
        lg: "h-12 px-6",
        icon: "size-10 rounded-md px-0 max-md:size-11",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  }
);

function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

/**
 * The same treatment on a real anchor. A link that looks like a button is still
 * a link — it should middle-click, it should show a target in the status bar,
 * and it should not claim button semantics it doesn't have.
 */
function ButtonLink({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return (
    <Link
      data-slot="button-link"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, ButtonLink, buttonVariants };
