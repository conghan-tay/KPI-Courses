import { proxyJson } from "@/lib/gateway";

/**
 * POST /api/courses/:id/publish
 *
 * The publish rules live in the gateway, including the one worth restating:
 * thin positions warn but never block. POC_UserJourney.md is explicit that a
 * Specialist with two stances and forty pages of craft still has a course worth
 * selling. A 409 comes back carrying `blockers`, which the dialog lists.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/courses/[id]/publish">
) {
  const { id } = await ctx.params;
  return proxyJson(`/v1/courses/${encodeURIComponent(id)}/publish`, {
    method: "POST",
  });
}
