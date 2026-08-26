import {
  ExtractError,
  extractFile,
  isSupportedFile,
  joinCorpus,
  type ExtractedFile,
} from "@/lib/extract";
import { newDraftCourse } from "@/lib/courses";
import { streamIngestion } from "@/lib/ingest/stream";
import { courseStore } from "@/lib/store";
import { getCurrentUser } from "@/lib/session";
import { CourseMetaSchema } from "@/lib/types";

// POST /api/courses/ingest — files + meta → draft course.
//
// Two response shapes on purpose. Anything we can decide before the model runs
// (bad price, a scanned PDF) comes back as a normal JSON error, because the
// dropzone needs to put the message next to the field. Once ingestion starts,
// the response becomes an SSE stream: the panel shows a line of streamed status
// and no percentage it can't honour (DESIGN.md §4.14).

export const dynamic = "force-dynamic";

const MAX_SOURCE_CHARS = 400_000;

export async function POST(request: Request) {
  const user = await getCurrentUser();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: { code: "bad_request", message: "Expected a multipart form." } },
      { status: 400 }
    );
  }

  const meta = CourseMetaSchema.safeParse({
    title: String(form.get("title") ?? ""),
    tagline: String(form.get("tagline") ?? ""),
    price_cents: Number(form.get("price_cents") ?? 0),
  });

  if (!meta.success) {
    return Response.json(
      {
        error: {
          code: "invalid_meta",
          message: "Check the course details.",
          fields: fieldErrors(meta.error.issues),
        },
      },
      { status: 400 }
    );
  }

  const uploads = form.getAll("files").filter((v): v is File => v instanceof File);
  const pasted = String(form.get("pasted_text") ?? "").trim();

  if (uploads.length === 0 && !pasted) {
    return Response.json(
      {
        error: {
          code: "no_source",
          message: "Drop a file or paste your material first.",
        },
      },
      { status: 400 }
    );
  }

  const extracted: ExtractedFile[] = [];
  for (const upload of uploads) {
    if (!isSupportedFile(upload.name)) {
      return Response.json(
        {
          error: {
            code: "unsupported_type",
            message: `${upload.name} isn't markdown, plain text, or a PDF.`,
            file: upload.name,
          },
        },
        { status: 415 }
      );
    }
    try {
      extracted.push(await extractFile(upload));
    } catch (error) {
      if (error instanceof ExtractError) {
        // `no_text_layer` is the designed scan state: the dropzone switches to
        // the paste tab and says so, rather than showing a generic failure.
        return Response.json(
          {
            error: {
              code: error.code,
              message: error.message,
              file: error.fileName,
            },
          },
          { status: 422 }
        );
      }
      throw error;
    }
  }

  if (pasted) {
    extracted.push({ name: "pasted text", text: pasted, meta: {} });
  }

  const sourceText = joinCorpus(extracted).slice(0, MAX_SOURCE_CHARS);
  if (sourceText.trim().length < 200) {
    return Response.json(
      {
        error: {
          code: "too_short",
          message:
            "There isn't enough material here to build a course from. Drop more, or paste the text.",
        },
      },
      { status: 422 }
    );
  }

  const draft = await courseStore.create(
    newDraftCourse({
      user,
      meta: meta.data,
      sourceText,
      sourceFiles: extracted.map((file) => file.name),
    })
  );

  return streamIngestion(draft.id, {
    specialistName: user.name,
    title: meta.data.title,
    tagline: meta.data.tagline,
    sourceText,
    fileNames: extracted.map((file) => file.name),
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
