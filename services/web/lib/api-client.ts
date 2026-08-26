import type {
  Course,
  CoursePatch,
  CourseSummary,
  IngestEvent,
  PublicCourse,
} from "@/lib/types";

/**
 * The only place a screen touches the network.
 *
 * Today these routes are served by this app's own route handlers. When the Go
 * gateway grows `/api/courses/*`, pointing at it is `NEXT_PUBLIC_API_BASE` and
 * nothing else — no component changes, no new fetch calls scattered through
 * pages.
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

export async function listCourses(): Promise<CourseSummary[]> {
  const { courses } = await request<{ courses: CourseSummary[] }>(
    "/api/courses"
  );
  return courses;
}

export async function getCourse(id: string): Promise<Course> {
  const { course } = await request<{ course: Course }>(`/api/courses/${id}`);
  return course;
}

/**
 * The projection a stranger gets. Applied by the Go API — see
 * ToPublic in services/gateway/internal/courses/courses.go — so the locked
 * cards genuinely have nothing to reveal.
 */
export async function getPublicCourse(id: string): Promise<PublicCourse> {
  const { course } = await request<{ course: PublicCourse }>(
    `/api/courses/${id}?audience=public`
  );
  return course;
}

export async function patchCourse(
  id: string,
  patch: CoursePatch
): Promise<Course> {
  const { course } = await request<{ course: Course }>(`/api/courses/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return course;
}

export async function publishCourse(
  id: string
): Promise<{ course: Course; url: string }> {
  return request<{ course: Course; url: string }>(
    `/api/courses/${id}/publish`,
    { method: "POST" }
  );
}

export async function softenPosition(
  id: string,
  index: number
): Promise<Course> {
  const { course } = await request<{ course: Course }>(
    `/api/courses/${id}/positions/${index}/soften`,
    { method: "POST" }
  );
  return course;
}

/**
 * Ingestion streams, and `EventSource` can only GET — so the stream is read off
 * a POST with a reader. Yields every server-sent event in order; the caller
 * decides what to do with `status`, `draft`, `result` and `error`.
 */
export async function* ingestCourse(
  body: FormData,
  signal?: AbortSignal
): AsyncGenerator<IngestEvent> {
  const response = await fetch(`${BASE}/api/courses/ingest`, {
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

export async function* reingestCourse(
  id: string,
  signal?: AbortSignal
): AsyncGenerator<IngestEvent> {
  const response = await fetch(`${BASE}/api/courses/${id}/reingest`, {
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
