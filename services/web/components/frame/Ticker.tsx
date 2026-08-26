import { cn } from "@/lib/utils";

// DESIGN.md §4.13 — black bar, 44px, pink label caps, ✕✕ separators, scrolling
// at ~40s a loop. Pink on black is 10.96:1, which is why the one place pink
// carries text is here.
//
// The phrase list is rendered twice so the loop is seamless at translateX(-50%).
// That also means `prefers-reduced-motion` can freeze it at either end without
// the strip ever looking half-scrolled.

export function Ticker({
  phrases,
  className,
}: {
  phrases: string[];
  className?: string;
}) {
  const line = `${phrases.map((phrase) => `✕✕ ${phrase} `).join("")}`;

  return (
    <div
      aria-hidden
      className={cn(
        "flex h-11 items-center overflow-hidden bg-ink text-pink",
        className
      )}
    >
      <div className="ticker-scroll flex shrink-0 whitespace-nowrap">
        <span className="type-label pr-10">{line}</span>
        <span className="type-label pr-10">{line}</span>
      </div>
    </div>
  );
}
