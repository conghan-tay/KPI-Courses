import { proxyJson } from "@/lib/gateway";

/**
 * GET /api/kb — the studio list.
 *
 * Scoping to the signed-in candidate happens in the gateway, from the
 * `X-Candidate-Id` lib/gateway.ts attaches. This route exists so the browser
 * can stay same-origin and never see the API key.
 */
export async function GET() {
  return proxyJson("/v1/knowledge-bases");
}
