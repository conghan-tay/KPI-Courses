import { applyIngestResult, markIngestFailed } from "@/lib/courses";
import { runIngestion, type IngestInput } from "@/lib/ingest";
import { courseStore } from "@/lib/store";
import type { IngestEvent } from "@/lib/types";

/**
 * Server-sent events for the ingestion panel, shared by the first run and the
 * retry. `EventSource` cannot POST, so the client reads this with
 * `fetch` + `getReader()` — see lib/api-client.ts.
 *
 * The draft id is sent before anything can go wrong, which is what lets a
 * failure leave a retryable course behind rather than a lost upload.
 */
export function streamIngestion(
  courseId: string,
  input: IngestInput
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: IngestEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      send({ type: "draft", course_id: courseId });

      try {
        const result = await runIngestion(input, (message) =>
          send({ type: "status", message })
        );
        await courseStore.update(courseId, (course) =>
          applyIngestResult(course, result)
        );
        send({ type: "result", course_id: courseId });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Ingestion failed.";
        await courseStore.update(courseId, (course) =>
          markIngestFailed(course, message)
        );
        send({
          type: "error",
          code: "ingest_failed",
          message,
          course_id: courseId,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer streamed responses into uselessness.
      "X-Accel-Buffering": "no",
    },
  });
}
