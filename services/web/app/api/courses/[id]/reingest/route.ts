import { streamIngestion } from "@/lib/ingest/stream";
import { courseStore } from "@/lib/store";
import { getCurrentUser } from "@/lib/session";

/**
 * POST /api/courses/:id/reingest
 *
 * The retry behind a failed draft. The source text was stored on the way in, so
 * this never asks the Specialist to re-upload anything — which is the whole
 * point of writing the draft before calling the model.
 */
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/courses/[id]/reingest">
) {
  const { id } = await ctx.params;
  const course = await courseStore.get(id);
  if (!course) {
    return Response.json(
      { error: { code: "not_found", message: "No such course." } },
      { status: 404 }
    );
  }

  const user = await getCurrentUser();
  if (course.specialist_id !== user.id) {
    return Response.json(
      { error: { code: "forbidden", message: "That isn't your course." } },
      { status: 403 }
    );
  }

  await courseStore.update(id, (current) => ({
    ...current,
    ingest_status: "running",
    ingest_error: undefined,
  }));

  return streamIngestion(course.id, {
    specialistName: course.specialist_name,
    title: course.title,
    tagline: course.tagline,
    sourceText: course.source_text,
    fileNames: course.source_files,
  });
}
