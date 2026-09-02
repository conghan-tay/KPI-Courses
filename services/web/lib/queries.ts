import { GatewayRequestError, gatewayJson } from "@/lib/gateway";
import type { KBSummary, KnowledgeBase } from "@/lib/types";

/**
 * Server-side reads.
 *
 * Server Components call the Go API directly rather than fetching this app's own
 * route handlers — a server fetching itself to reach a third server is a round
 * trip that buys nothing. Mutations and streams go through lib/api-client.ts
 * from the browser, which hits the proxies in app/api/kb/*.
 *
 * Those two files plus lib/gateway.ts are the whole data seam. Nothing in
 * `app/` or `components/` knows the gateway exists.
 */

export async function listMyKnowledgeBases(): Promise<KBSummary[]> {
  const { knowledge_bases } = await gatewayJson<{
    knowledge_bases: KBSummary[];
  }>("/v1/knowledge-bases");
  return knowledge_bases;
}

/**
 * Null covers "no such knowledge base", "not yours", and "the gateway said no" —
 * the screen 404s for all of them. A gateway that is *down* is a different thing
 * and throws, so an outage surfaces as an error page rather than as a studio
 * that quietly claims your work does not exist.
 */
export async function getMyKnowledgeBase(
  id: string
): Promise<KnowledgeBase | null> {
  try {
    const { knowledge_base } = await gatewayJson<{
      knowledge_base: KnowledgeBase;
    }>(`/v1/knowledge-bases/${encodeURIComponent(id)}`);
    return knowledge_base;
  } catch (error) {
    if (
      error instanceof GatewayRequestError &&
      (error.status === 404 || error.status === 403)
    ) {
      return null;
    }
    throw error;
  }
}
