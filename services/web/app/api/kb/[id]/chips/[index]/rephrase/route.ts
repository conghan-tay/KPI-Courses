import type { NextRequest } from "next/server";

import { proxyJson } from "@/lib/gateway";

/**
 * POST /api/kb/:id/chips/:index/rephrase
 *
 * `Rephrase` from the review screen's Chips tab. The rewrite runs as a Temporal
 * workflow behind the gateway, so no model client lives in this app or in Go.
 * `?register=` asks for a different register — skeptical, narrative or blunt —
 * which is what makes the button "say this another way" rather than "roll the
 * dice". With the fixture model it returns a deterministic rewrite, so the
 * button is never dead.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/kb/[id]/chips/[index]/rephrase">
) {
  const { id, index } = await ctx.params;
  const register = request.nextUrl.searchParams.get("register");
  return proxyJson(
    `/v1/knowledge-bases/${encodeURIComponent(id)}/chips/${encodeURIComponent(
      index
    )}/rephrase${register ? `?register=${encodeURIComponent(register)}` : ""}`,
    { method: "POST" }
  );
}
