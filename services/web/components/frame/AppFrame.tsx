import Link from "next/link";

import { Ticker } from "@/components/frame/Ticker";
import { RoleSwitcher } from "@/components/frame/RoleSwitcher";
import { getCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

// DESIGN.md §5.1 — every screen is a sheet on a surround. That single
// structural move is the whole identity, and it costs one component.
//
//   ░░░ surround (pink) ░░░
//   ░ ╔══ meander rail ══╗ ░
//   ░ ║  ● ● ●   NAV     ║ ░   3px black border
//   ░ ║  paper · content ║ ░
//   ░ ║ ✕✕ ticker ✕✕     ║ ░
//   ░ ╚══════════════════╝ ░
//
// `scroll`  the whole sheet scrolls with the page (marketing screens).
// `fixed`   the sheet fills the viewport and its content scrolls internally, so
//           the frame stays put on /studio/:id and /learn.

const TICKER_PHRASES = [
  "Knowledge from people who argue back",
  "Two inks and paper",
  "Your opinions are the asset",
];

export async function AppFrame({
  children,
  variant = "scroll",
  contentClassName,
}: {
  children: React.ReactNode;
  variant?: "scroll" | "fixed";
  contentClassName?: string;
}) {
  const user = await getCurrentUser();
  const fixed = variant === "fixed";

  return (
    <div
      className={cn(
        // Surround margin: 32px at ≥1280, 16px at 768–1279, 0 below.
        "flex flex-col bg-surround p-8 max-lg:p-4 max-md:p-0",
        fixed ? "h-dvh" : "min-h-dvh"
      )}
    >
      {/* The sheet always fills the viewport, so the surround reads as a margin
          around a printed page rather than as an empty pink screen. */}
      <div
        className={cn(
          "mx-auto flex w-full max-w-[1440px] flex-1 flex-col border-[3px] border-ink bg-paper max-md:border-2",
          fixed && "min-h-0"
        )}
      >
        {/* The meander rail is ceremony. It is the first thing to go on mobile. */}
        <div
          aria-hidden
          className="pat-meander h-7 shrink-0 border-b-[3px] border-ink max-md:hidden"
        />

        <header className="pat-halftone flex shrink-0 flex-wrap items-center justify-between gap-4 border-b-[3px] border-ink px-6 py-3 max-md:border-b-2">
          <div aria-hidden className="flex gap-2 max-md:hidden">
            <span className="size-3 rounded-full bg-ink" />
            <span className="size-3 rounded-full bg-ink" />
            <span className="size-3 rounded-full bg-ink" />
          </div>

          {/* Never set text directly on halftone — §4.14. The dots sit at 30%
              black and destroy small type, so every nav item is a paper box. */}
          <nav className="flex items-center gap-2">
            <Link
              href="/studio"
              className="type-label border-2 border-ink bg-paper px-2.5 py-1 text-ink hover:bg-pink"
            >
              Studio
            </Link>
            <span className="type-meta border-2 border-ink-faint bg-paper px-2.5 py-1.5 text-ink-faint max-md:hidden">
              Catalog · soon
            </span>
          </nav>

          <RoleSwitcher user={user} />
        </header>

        <main
          className={cn(
            "mx-auto w-full max-w-[1200px] flex-1 px-10 py-12 max-md:px-5 max-md:py-8",
            fixed && "min-h-0 overflow-y-auto",
            contentClassName
          )}
        >
          {children}
        </main>

        <Ticker
          phrases={TICKER_PHRASES}
          className="shrink-0 border-t-[3px] border-ink max-md:hidden"
        />
      </div>
    </div>
  );
}
