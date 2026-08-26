import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The proxy seam.
 *
 * Every designed failure state on the Specialist's screen branches on
 * `error.code` — `not_publishable` lists blockers, `invalid_meta` puts a message
 * next to a field, `no_text_layer` switches to the paste tab. All of that is one
 * envelope crossing two hops, and if the proxy flattens it the screens degrade
 * to a generic "something went wrong" without anything failing loudly.
 *
 * `server-only` throws outside a Server Component, and lib/session reaches for
 * `next/headers`; both are stubbed so this can be an ordinary unit test.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({
  getCurrentUser: async () => ({
    id: "user-dana",
    name: "Dana Mercado",
    role: "specialist",
    initials: "DM",
    bio: "",
  }),
}));

const { GatewayRequestError, gatewayFetch, gatewayJson, proxyJson, proxyStream } =
  await import("@/lib/gateway");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetch(response: Response | (() => Promise<never>)) {
  const spy = vi.fn(
    typeof response === "function" ? response : async () => response.clone()
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("gatewayFetch", () => {
  it("sends the API key and the signed-in specialist, and never caches", async () => {
    const spy = stubFetch(jsonResponse(200, { courses: [] }));
    vi.stubEnv("GATEWAY_API_KEY", "secret");

    await gatewayFetch("/v1/courses");

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/courses");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("secret");
    // The server-side half of the SIGN IN AS switcher.
    expect(headers["X-Specialist-Id"]).toBe("user-dana");
    // A cached studio list would show a published course as a draft.
    expect(init.cache).toBe("no-store");
  });
});

describe("proxyJson", () => {
  it("forwards a success body and status untouched", async () => {
    stubFetch(jsonResponse(200, { course: { id: "course-1" } }));

    const response = await proxyJson("/v1/courses/course-1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ course: { id: "course-1" } });
  });

  it("forwards the publish blockers verbatim, with the 409", async () => {
    // The one error the dialog actually reads a list out of. Losing `blockers`
    // here would leave the Specialist guessing at what to fix.
    stubFetch(
      jsonResponse(409, {
        error: {
          code: "not_publishable",
          message: "Set a price. Free courses can't be published yet.",
          blockers: [
            "Set a price. Free courses can't be published yet.",
            "A course with no lessons has nothing to teach.",
          ],
        },
      })
    );

    const response = await proxyJson("/v1/courses/course-1/publish", {
      method: "POST",
    });

    expect(response.status).toBe(409);
    const { error } = await response.json();
    expect(error.code).toBe("not_publishable");
    expect(error.blockers).toHaveLength(2);
  });

  it("forwards field errors so a message can sit next to its input", async () => {
    stubFetch(
      jsonResponse(400, {
        error: {
          code: "invalid_request",
          message: "price_cents must be a positive number of cents",
          fields: { price_cents: "must be a positive number of cents" },
        },
      })
    );

    const { error } = await (
      await proxyJson("/v1/courses/ingest", { method: "POST", body: {} })
    ).json();

    expect(error.fields.price_cents).toBeTruthy();
  });

  it("turns an unreachable gateway into something a person can act on", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const response = await proxyJson("/v1/courses");

    expect(response.status).toBe(502);
    const { error } = await response.json();
    expect(error.code).toBe("gateway_unreachable");
    expect(error.message).not.toContain("fetch failed");
  });
});

describe("proxyStream", () => {
  it("passes the body through rather than buffering it", async () => {
    // Buffering would collect every status line and deliver them in one burst at
    // the end, which is exactly what the ingestion panel exists not to do.
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"type":"draft","course_id":"course-1"}\n\n',
      'data: {"type":"status","message":"READING 1 OF 1 FILES · source.md"}\n\n',
      'data: {"type":"result","course_id":"course-1"}\n\n',
    ];
    let released!: () => void;
    const gate = new Promise<void>((resolve) => {
      released = resolve;
    });

    stubFetch(
      new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode(chunks[0]));
            await gate;
            controller.enqueue(encoder.encode(chunks[1]));
            controller.enqueue(encoder.encode(chunks[2]));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )
    );

    const response = await proxyStream("/v1/courses/ingest", {
      method: "POST",
      body: {},
    });

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    // Proxies buffer streamed responses into uselessness without this.
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // The first frame is readable before the upstream has sent the rest.
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain('"type":"draft"');

    released();
    let rest = "";
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      rest += decoder.decode(next.value);
    }
    expect(rest).toContain("READING 1 OF 1 FILES");
    expect(rest).toContain('"type":"result"');
  });

  it("reports a refused stream as JSON, not as an empty stream", async () => {
    stubFetch(
      jsonResponse(409, {
        error: { code: "already_running", message: "That course is already being built." },
      })
    );

    const response = await proxyStream("/v1/courses/ingest", { method: "POST" });

    expect(response.status).toBe(409);
    const { error } = await response.json();
    expect(error.code).toBe("already_running");
  });
});

describe("gatewayJson", () => {
  it("throws a typed error the Server Components can branch on", async () => {
    stubFetch(jsonResponse(404, { error: { code: "not_found", message: "No such course." } }));

    await expect(gatewayJson("/v1/courses/nope")).rejects.toMatchObject({
      status: 404,
      detail: { code: "not_found" },
    });
    await expect(gatewayJson("/v1/courses/nope")).rejects.toBeInstanceOf(
      GatewayRequestError
    );
  });

  it("returns the parsed body on success", async () => {
    stubFetch(jsonResponse(200, { courses: [{ id: "course-1" }] }));

    await expect(gatewayJson("/v1/courses")).resolves.toEqual({
      courses: [{ id: "course-1" }],
    });
  });
});
