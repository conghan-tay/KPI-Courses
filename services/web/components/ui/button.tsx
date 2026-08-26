import Link from "next/link";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// DESIGN.md §4.1 — pill, 2px black border, bold uppercase label. Hover lifts the
// button up-left and reveals the hard shadow; press slams it back down. The
// lift-and-slam is the only tactility in a flat system, so it is not optional.
// `disabled:pointer-events-none` is what keeps the lift off disabled buttons.
const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-pill border-2 border-ink",
    "type-label whitespace-nowrap select-none cursor-pointer",
    "transition-transform duration-[90ms] ease-[steps(3)]",
    "hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-lift",
    "active:translate-x-0 active:translate-y-0 active:shadow-none",
    "disabled:pointer-events-none disabled:border-ink-faint disabled:bg-paper disabled:text-ink-faint",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
  ),
  {
    variants: {
      variant: {
        primary: "bg-ink text-paper",
        accent: "bg-pink text-ink active:bg-pink-deep",
        secondary: "bg-paper text-ink hover:bg-pink active:bg-pink-deep",
        // The pink highlighter block behind the text is the hover state; the
        // button itself neither lifts nor carries a border.
        // A ghost button has no border at rest, so it must not grow one when
        // it is disabled either.
        ghost:
          "border-transparent bg-transparent text-ink px-2 hover:translate-x-0 hover:translate-y-0 hover:bg-pink hover:shadow-none disabled:border-transparent disabled:bg-transparent",
        destructive:
          "bg-paper border-alert text-alert hover:bg-alert hover:text-paper",
      },
      size: {
        sm: "h-[34px] px-4 text-[12px]",
        // 44px is the default and the tablet touch-target floor. Never use `sm`
        // for a primary action on tablet.
        md: "h-11 px-6",
        lg: "h-14 px-9 text-[15px]",
        // Icon-only buttons are circles, never pills, and never below 44px.
        icon: "size-11 rounded-full px-0",
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
