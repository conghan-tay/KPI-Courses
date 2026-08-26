import { proxyJson } from "@/lib/gateway";

/**
 * POST /api/courses/:id/positions/:index/soften
 *
 * `Soften` from POC_UserJourney.md's review screen. The rewrite runs as a
 * Temporal workflow behind the gateway, so no model client lives in this app or
 * in Go. With the fixture model it returns a deterministic hedge, which is what
 * keeps the button from ever being dead.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/courses/[id]/positions/[index]/soften">
) {
  const { id, index } = await ctx.params;
  return proxyJson(
    `/v1/courses/${encodeURIComponent(id)}/positions/${encodeURIComponent(
      index
    )}/soften`,
    { method: "POST" }
  );
}
