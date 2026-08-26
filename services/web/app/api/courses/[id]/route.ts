import type { NextRequest } from "next/server";

import { proxyJson } from "@/lib/gateway";

/**
 * GET /api/courses/:id
 *
 * `?audience=public` is forwarded, and the gateway applies the projection —
 * no `because`, no `pushback`, no lesson bodies (DESIGN.md §4.5). It matters
 * that the withholding happens there and not here: the review screen's preview
 * panel calls this with that flag precisely to prove the locked cards have
 * nothing to reveal, and a projection applied in the BFF would be one more place
 * that could quietly stop being applied.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/courses/[id]">
) {
  const { id } = await ctx.params;
  const audience = request.nextUrl.searchParams.get("audience");
  return proxyJson(
    `/v1/courses/${encodeURIComponent(id)}${
      audience === "public" ? "?audience=public" : ""
    }`
  );
}

/** PATCH /api/courses/:id — partial edits from the review screen. */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/courses/[id]">
) {
  const { id } = await ctx.params;
  const patch: unknown = await request.json().catch(() => null);
  return proxyJson(`/v1/courses/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch ?? {},
  });
}
