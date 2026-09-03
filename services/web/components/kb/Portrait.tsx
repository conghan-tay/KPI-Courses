import { cn } from "@/lib/utils";

// NEW_DESIGN.md §4 — a plain photograph on a hairline ring. The duotone filter
// belonged to a two-ink system that no longer exists; a warm-neutral page can
// carry an unprocessed photo without falling apart.
//
// With no photo we fall back to initials on a sunk disc.

const SIZES = {
  sm: "size-8 text-[12px]",
  md: "size-12 text-[16px]",
  lg: "size-20 text-[26px]",
} as const;

export function Portrait({
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
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full",
        "border border-hairline bg-surface-sunk font-medium text-ink-muted",
        SIZES[size],
        className
      )}
    >
      {src ? (
        // A plain <img>: these are small avatars, not LCP images, and the src is
        // arbitrary user-supplied URL rather than a build-time asset.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="portrait-img" />
      ) : (
        <span aria-hidden>{initials}</span>
      )}
      {!src && <span className="sr-only">{name}</span>}
    </div>
  );
}
