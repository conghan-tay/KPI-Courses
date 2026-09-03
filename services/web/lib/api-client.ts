import type {
  IngestEvent,
  KBPatch,
  KBSummary,
  KnowledgeBase,
  PublicKB,
} from "@/lib/types";

/**
 * The only place a screen touches the network.
 *
 * These routes are served by this app's own route handlers, which proxy to the
 * Go gateway. Screens stay same-origin and never see the API key.
 */
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export type ApiError = {
  code: string;
  message: string;
  file?: string;
  fields?: Record<string, string>;
  blockers?: string[];
};

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: ApiError
  ) {
    super(detail.message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "error" in payload
        ? ((payload as { error: ApiError }).error satisfies ApiError)
        : { code: "unknown", message: `Request failed (${response.status}).` };
    throw new ApiRequestError(response.status, detail);
  }

  return payload as T;
}

export async function listKnowledgeBases(): Promise<KBSummary[]> {
  const { knowledge_bases } = await request<{ knowledge_bases: KBSummary[] }>(
    "/api/kb"
  );
  return knowledge_bases;
}

export async function getKnowledgeBase(id: string): Promise<KnowledgeBase> {
  const { knowledge_base } = await request<{ knowledge_base: KnowledgeBase }>(
    `/api/kb/${id}`
  );
  return knowledge_base;
}

/**
 * The projection a stranger gets. Applied by the Go API — see ToPublic in
 * services/gateway/internal/kb/kb.go — so the preview panel proves the
 * withholding rule rather than imitating it. In particular there is no quiz in
 * this payload, and that is a security control: the quiz gates booking real
 * time, and a leaked `correct_index` makes the gate a formality.
 */
export async function getPublicKB(id: string): Promise<PublicKB> {
  const { knowledge_base } = await request<{ knowledge_base: PublicKB }>(
    `/api/kb/${id}?audience=public`
  );
  return knowledge_base;
}

export async function patchKnowledgeBase(
  id: string,
  patch: KBPatch
): Promise<KnowledgeBase> {
  const { knowledge_base } = await request<{ knowledge_base: KnowledgeBase }>(
    `/api/kb/${id}`,
    { method: "PATCH", body: JSON.stringify(patch) }
  );
  return knowledge_base;
}

export async function publishKnowledgeBase(
  id: string
): Promise<{ knowledge_base: KnowledgeBase; url: string }> {
  return request<{ knowledge_base: KnowledgeBase; url: string }>(
    `/api/kb/${id}/publish`,
    { method: "POST" }
  );
}

/** Rewrite one opening question, optionally in a different register. */
export async function rephraseChip(
  id: string,
  index: number,
  register?: string
): Promise<KnowledgeBase> {
  const query = register ? `?register=${encodeURIComponent(register)}` : "";
  const { knowledge_base } = await request<{ knowledge_base: KnowledgeBase }>(
    `/api/kb/${id}/chips/${index}/rephrase${query}`,
    { method: "POST" }
  );
  return knowledge_base;
}

/**
 * Ingestion streams, and `EventSource` can only GET — so the stream is read off
 * a POST with a reader. Yields every server-sent event in order; the caller
 * decides what to do with `status`, `draft`, `result` and `error`.
 */
export async function* ingestKnowledgeBase(
  body: FormData,
  signal?: AbortSignal
): AsyncGenerator<IngestEvent> {
  const response = await fetch(`${BASE}/api/kb/ingest`, {
    method: "POST",
    body,
    signal,
  });

  if (!response.ok || !response.body) {
    const payload: unknown = await response.json().catch(() => null);
    const detail =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error: ApiError }).error
        : { code: "unknown", message: "Ingestion could not start." };
    throw new ApiRequestError(response.status, detail);
  }

  yield* readEventStream(response.body, signal);
}

export async function* reingestKnowledgeBase(
  id: string,
  signal?: AbortSignal
): AsyncGenerator<IngestEvent> {
  const response = await fetch(`${BASE}/api/kb/${id}/reingest`, {
    method: "POST",
    signal,
  });

  if (!response.ok || !response.body) {
    throw new ApiRequestError(response.status, {
      code: "unknown",
      message: "Retry could not start.",
    });
  }

  yield* readEventStream(response.body, signal);
}

async function* readEventStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<IngestEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; a frame can arrive split
      // across chunks, so only complete ones are parsed.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (data) yield JSON.parse(data) as IngestEvent;
        boundary = buffer.indexOf("\n\n");
      }

      if (signal?.aborted) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
