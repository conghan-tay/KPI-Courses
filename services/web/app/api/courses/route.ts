import { proxyJson } from "@/lib/gateway";

/**
 * GET /api/courses — the studio list.
 *
 * Scoping to the signed-in Specialist happens in the gateway, from the
 * `X-Specialist-Id` lib/gateway.ts attaches. This route exists so the browser
 * can stay same-origin and never see the API key.
 */
export async function GET() {
  return proxyJson("/v1/courses");
}
