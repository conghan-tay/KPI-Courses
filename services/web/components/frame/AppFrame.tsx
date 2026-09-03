import Link from "next/link";

import { RoleSwitcher } from "@/components/frame/RoleSwitcher";
import { getCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

// NEW_DESIGN.md §5 — a cream page with a white content column. No surround, no
// border, no meander rail, no ticker.
//
// Chrome that carries no information is deleted rather than restyled. The
// previous frame spent roughly 200px of vertical and 64px of horizontal on
// ceremony before a single word of the candidate's material, which is what left
// a chip card 284px wide.
//
// `scroll`  the page scrolls normally.
// `fixed`   the header stays put and the content scrolls under it, for the
//           review screen where the tab row should not leave the viewport.

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
    <div className={cn("flex flex-col bg-canvas", fixed ? "h-dvh" : "min-h-dvh")}>
      {/* 64px, one line, always. A two-line header at desktop is broken. */}
      <header className="sticky top-0 z-30 h-16 shrink-0 border-b border-hairline bg-canvas/95 backdrop-blur-sm">
        <div className="mx-auto flex h-full w-full max-w-[1440px] items-center gap-6 px-8 max-md:px-4">
          <Link
            href="/studio"
            className="type-label shrink-0 text-ink hover:text-ink-muted"
          >
            Reverse Interview
          </Link>

          <nav className="flex items-center gap-1">
            <Link
              href="/studio"
              className="type-body-sm rounded-md px-3 py-1.5 text-ink hover:bg-surface-sunk"
            >
              Studio
            </Link>
            <span className="type-body-sm rounded-md px-3 py-1.5 text-ink-faint max-md:hidden">
              Recruiters, soon
            </span>
          </nav>

          <div className="ml-auto shrink-0">
            <RoleSwitcher user={user} />
          </div>
        </div>
      </header>

      <main
        className={cn(
          "mx-auto w-full max-w-[1440px] flex-1 px-8 py-10 max-md:px-4 max-md:py-6",
          fixed && "min-h-0 overflow-y-auto",
          contentClassName
        )}
      >
        {children}
      </main>
    </div>
  );
}
