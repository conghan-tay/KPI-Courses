import {
  ExtractError,
  extractFile,
  isSupportedFile,
  joinCorpus,
  type ExtractedFile,
} from "@/lib/extract";
import { errorResponse, proxyStream } from "@/lib/gateway";
import { KBMetaSchema } from "@/lib/types";

/**
 * POST /api/kb/ingest — documents + meta → a draft knowledge base and a stream.
 *
 * This is the one route that is more than a proxy, and the reason is upload
 * handling. Turning a dropped PDF into text stays here, in front of the Go API:
 * pdf.js is materially better at it than anything in Go, the designed "this
 * looks like a scan" state is already built around `lib/extract.ts`, and raw
 * file bytes never go near Temporal's payload limit. The gateway's ingest
 * endpoint takes text.
 *
 * Two response shapes, on purpose. Anything decidable before the pipeline runs —
 * a missing name, a scanned PDF, forty words of material — comes back as
 * ordinary JSON, because the dropzone needs to put the message next to the
 * field. Once ingestion starts the response becomes SSE: a line of streamed
 * status and no percentage we can't honour (DESIGN.md §4.14).
 */

export const dynamic = "force-dynamic";

// Mirrors MaxSourceChars in services/gateway/internal/api/types.go. Trimming
// here means a paste bomb is cut before it crosses the wire rather than after.
const MAX_SOURCE_CHARS = 400_000;

// Below this there is nothing to build a knowledge base from, and a model asked
// to try will invent one. The gateway enforces the same floor.
const MIN_SOURCE_CHARS = 200;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, {
      code: "bad_request",
      message: "Expected a multipart form.",
    });
  }

  const meta = KBMetaSchema.safeParse({
    title: String(form.get("title") ?? ""),
    tagline: String(form.get("tagline") ?? ""),
  });

  if (!meta.success) {
    return errorResponse(400, {
      code: "invalid_meta",
      message: "Check your name and one-liner.",
      fields: fieldErrors(meta.error.issues),
    });
  }

  const uploads = form.getAll("files").filter((v): v is File => v instanceof File);
  const pasted = String(form.get("pasted_text") ?? "").trim();

  if (uploads.length === 0 && !pasted) {
    return errorResponse(400, {
      code: "no_source",
      message: "Drop a file or paste your material first.",
    });
  }

  const extracted: ExtractedFile[] = [];
  for (const upload of uploads) {
    if (!isSupportedFile(upload.name)) {
      return errorResponse(415, {
        code: "unsupported_type",
        message: `${upload.name} isn't markdown, plain text, or a PDF.`,
        file: upload.name,
      });
    }
    try {
      extracted.push(await extractFile(upload));
    } catch (error) {
      if (error instanceof ExtractError) {
        // `no_text_layer` is the designed scan state: the dropzone switches to
        // the paste tab and says so, rather than showing a generic failure.
        return errorResponse(422, {
          code: error.code,
          message: error.message,
          file: error.fileName,
        });
      }
      throw error;
    }
  }

  if (pasted) {
    extracted.push({ name: "pasted text", text: pasted, meta: {} });
  }

  // The per-file headers joinCorpus writes are not decoration: the graph splits
  // the corpus back apart on them, and reading a CV separately from an
  // architecture write-up is what lets each document be classified at all.
  const sourceText = joinCorpus(extracted).slice(0, MAX_SOURCE_CHARS);
  if (sourceText.trim().length < MIN_SOURCE_CHARS) {
    return errorResponse(422, {
      code: "too_short",
      message:
        "There isn't enough here to build a knowledge base from. Drop more, or paste the text.",
    });
  }

  return proxyStream("/v1/knowledge-bases/ingest", {
    method: "POST",
    body: {
      title: meta.data.title,
      tagline: meta.data.tagline,
      source_text: sourceText,
      source_files: extracted.map((file) => file.name),
    },
  });
}

function fieldErrors(
  issues: { path: PropertyKey[]; message: string }[]
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fields[key]) fields[key] = issue.message;
  }
  return fields;
}
