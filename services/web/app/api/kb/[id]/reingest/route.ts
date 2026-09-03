import { proxyStream } from "@/lib/gateway";

/**
 * POST /api/kb/:id/reingest
 *
 * The retry behind a failed draft. The source text was stored on the way in, so
 * this never asks the candidate to re-upload anything — which is the whole point
 * of writing the draft before the pipeline runs. Same SSE stream as the first
 * attempt.
 */
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/kb/[id]/reingest">
) {
  const { id } = await ctx.params;
  return proxyStream(`/v1/knowledge-bases/${encodeURIComponent(id)}/reingest`, {
    method: "POST",
  });
}
