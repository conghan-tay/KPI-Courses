import "server-only";

import { getCurrentUser } from "@/lib/session";

/**
 * The server-side seam to the Go API.
 *
 * Everything under `app/api/kb/*` is a proxy in front of this, and the
 * reason is that the browser must not hold the gateway's API key. The web app
 * is a BFF: it resolves who is signed in from the cookie, adds the credentials,
 * and forwards. Screens keep calling same-origin `/api/kb/*` through
 * lib/api-client.ts and know nothing about any of it.
 *
 * `API_BASE_URL` is deliberately not `NEXT_PUBLIC_`: a public env var is baked
 * into the client bundle, and the gateway is not reachable from a browser.
 */

/**
 * Read per call rather than once at module load. Next inlines some module-level
 * `process.env` reads at build time, which would bake a container's address into
 * the bundle and make `API_BASE_URL` a lie in every other environment.
 */
function baseUrl(): string {
  return (process.env.API_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");
}

function apiKey(): string {
  return process.env.GATEWAY_API_KEY ?? "local-api-key";
}

/**
 * The error shape every route in this app produces, matching `ApiError` in
 * lib/api-client.ts. Screens branch on `code` — `no_text_layer` opens the paste
 * tab, `not_publishable` lists blockers — so a message alone is not enough.
 */
export type GatewayError = {
  code: string;
  message: string;
  file?: string;
  fields?: Record<string, string>;
  blockers?: string[];
};

export class GatewayRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: GatewayError
  ) {
    super(detail.message);
    this.name = "GatewayRequestError";
  }
}

/** `{ error: {...} }`, the one body shape this app's routes return on failure. */
export function errorResponse(
  status: number,
  error: GatewayError
): Response {
  return Response.json({ error }, { status });
}

/**
 * A fetch that never reached the gateway: the container is down, or DNS is. The
 * candidate gets something true and actionable rather than a stack trace, and
 * the `code` lets a screen tell "the service is down" apart from "your knowledge base is
 * gone".
 */
const UNREACHABLE: GatewayError = {
  code: "gateway_unreachable",
  message: "The knowledge-base service isn't responding. Try again in a moment.",
};

type GatewayInit = Omit<RequestInit, "body"> & { body?: unknown };

/**
 * One request to the Go API, as the signed-in candidate.
 *
 * `X-Candidate-Id` is the server-side half of the `SIGN IN AS` switcher. The
 * gateway trusts it because the API key gates this hop — which is POC-grade
 * auth, exactly as POC_UserJourney.md §0 says, and must be replaced before this
 * meets a real user.
 */
export async function gatewayFetch(
  path: string,
  init: GatewayInit = {}
): Promise<Response> {
  const user = await getCurrentUser();
  const { body, headers, ...rest } = init;

  return fetch(`${baseUrl()}${path}`, {
    ...rest,
    headers: {
      "X-API-Key": apiKey(),
      "X-Candidate-Id": user.id,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Knowledge-base data changes as the candidate edits it; a cached studio list would
    // show one that has already been published as a draft.
    cache: "no-store",
  });
}

/** A JSON call that throws `GatewayRequestError` on anything but 2xx. */
export async function gatewayJson<T>(
  path: string,
  init: GatewayInit = {}
): Promise<T> {
  let response: Response;
  try {
    response = await gatewayFetch(path, init);
  } catch {
    throw new GatewayRequestError(502, UNREACHABLE);
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new GatewayRequestError(response.status, readError(payload, response.status));
  }
  return payload as T;
}

/**
 * Forward a gateway response verbatim — status, body and all.
 *
 * Proxying rather than re-deriving is the point: a 409 with `blockers` from the
 * publish route reaches the dialog exactly as the gateway wrote it, so there is
 * no second place where the error contract can drift.
 */
export async function proxyJson(
  path: string,
  init: GatewayInit = {}
): Promise<Response> {
  let response: Response;
  try {
    response = await gatewayFetch(path, init);
  } catch {
    return errorResponse(502, UNREACHABLE);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (payload === null) {
    return response.ok
      ? new Response(null, { status: response.status })
      : errorResponse(response.status, readError(payload, response.status));
  }
  return Response.json(payload, { status: response.status });
}

/**
 * Forward a server-sent event stream.
 *
 * The body is piped through untouched. Buffering it would collect every status
 * line and deliver them in one burst at the end, which is precisely what the
 * ingestion panel exists not to do.
 */
export async function proxyStream(
  path: string,
  init: GatewayInit = {}
): Promise<Response> {
  let response: Response;
  try {
    response = await gatewayFetch(path, init);
  } catch {
    return errorResponse(502, UNREACHABLE);
  }

  if (!response.ok || !response.body) {
    const payload: unknown = await response.json().catch(() => null);
    return errorResponse(
      response.ok ? 502 : response.status,
      readError(payload, response.status)
    );
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer streamed responses into uselessness.
      "X-Accel-Buffering": "no",
    },
  });
}

function readError(payload: unknown, status: number): GatewayError {
  if (payload && typeof payload === "object" && "error" in payload) {
    const detail = (payload as { error: unknown }).error;
    if (detail && typeof detail === "object" && "message" in detail) {
      return detail as GatewayError;
    }
  }
  return { code: "unknown", message: `Request failed (${status}).` };
}
