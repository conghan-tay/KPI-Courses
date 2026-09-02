import { cn } from "@/lib/utils";

// DESIGN.md §4.4 — duotone treatment, mandatory. Candidates upload arbitrary
// photographs and an unprocessed photo destroys a two-ink system instantly, so
// every portrait is filtered to black + pink in CSS.
//
// With no photo we fall back to initials on a pink disc, which is the same two
// inks by a different route.

const SIZES = {
  sm: "size-8 border-2 text-[12px]",
  md: "size-16 border-[3px] text-[20px]",
  lg: "size-[380px] border-[3px] text-[64px]",
} as const;

export function RisoPortrait({
  name,
  initials,
  src,
  size = "md",
  className,
}: {
  name: string;
  initials: string;
  src?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full border-ink bg-pink",
        "font-display font-extrabold tracking-[0.02em] text-ink",
        SIZES[size],
        className
      )}
    >
      {src ? (
        // The duotone filter and multiply blend need a plain <img>: next/image
        // wraps the element in a way that fights `mix-blend-mode` against the
        // pink ground, and these are small avatars, not LCP images.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="riso-portrait-img" />
      ) : (
        <span aria-hidden>{initials}</span>
      )}
      {!src && <span className="sr-only">{name}</span>}
    </div>
  );
}
