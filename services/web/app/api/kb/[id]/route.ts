import type { NextRequest } from "next/server";

import { proxyJson } from "@/lib/gateway";

/**
 * GET /api/kb/:id
 *
 * `?audience=public` is forwarded, and the gateway applies the projection — no
 * quiz, no `why_it_lands`, no section bodies. It matters that the withholding
 * happens there and not here: the review screen's preview panel calls this with
 * that flag precisely to prove the payload has nothing to reveal, and a
 * projection applied in the BFF would be one more place that could quietly stop
 * being applied.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/kb/[id]">
) {
  const { id } = await ctx.params;
  const audience = request.nextUrl.searchParams.get("audience");
  return proxyJson(
    `/v1/knowledge-bases/${encodeURIComponent(id)}${
      audience === "public" ? "?audience=public" : ""
    }`
  );
}

/** PATCH /api/kb/:id — partial edits from the review screen. */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/kb/[id]">
) {
  const { id } = await ctx.params;
  const patch: unknown = await request.json().catch(() => null);
  return proxyJson(`/v1/knowledge-bases/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch ?? {},
  });
}
