import { proxyJson } from "@/lib/gateway";

/**
 * POST /api/kb/:id/publish
 *
 * The publish rules live in the gateway, including the one worth restating: a
 * thin knowledge base warns but never blocks. What does block is a
 * recruiter-facing screen that cannot work — a front page without exactly three
 * questions on it, or a booking gate missing a whole category. A 409 comes back
 * carrying `blockers`, which the dialog lists.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/kb/[id]/publish">
) {
  const { id } = await ctx.params;
  return proxyJson(`/v1/knowledge-bases/${encodeURIComponent(id)}/publish`, {
    method: "POST",
  });
}
