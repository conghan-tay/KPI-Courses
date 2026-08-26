import type { NextRequest } from "next/server";

import { courseStore } from "@/lib/store";
import { toPublicCourse } from "@/lib/serialize";
import { getCurrentUser } from "@/lib/session";
import { CoursePatchSchema } from "@/lib/types";
import { renumber } from "@/lib/reducers";

/**
 * GET /api/courses/:id
 *
 * `?audience=public` returns the projection a stranger gets — no `because`, no
 * `pushback`, no lesson bodies (DESIGN.md §4.5). The review screen's preview
 * panel calls it with that flag deliberately: the locked position cards it
 * renders genuinely have nothing to reveal.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/courses/[id]">
) {
  const { id } = await ctx.params;
  const course = await courseStore.get(id);
  if (!course) return notFound();

  if (request.nextUrl.searchParams.get("audience") === "public") {
    return Response.json({ course: toPublicCourse(course) });
  }

  const user = await getCurrentUser();
  if (course.specialist_id !== user.id) return forbidden();

  return Response.json({ course });
}

/** PATCH /api/courses/:id — partial edits from the review screen. */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/courses/[id]">
) {
  const { id } = await ctx.params;
  const existing = await courseStore.get(id);
  if (!existing) return notFound();

  const user = await getCurrentUser();
  if (existing.specialist_id !== user.id) return forbidden();

  const parsed = CoursePatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: { code: "invalid_patch", message: "That edit didn't parse." } },
      { status: 400 }
    );
  }

  const patch = parsed.data;
  const course = await courseStore.update(id, (current) => ({
    ...current,
    ...patch,
    // Ordinals are the server's to assign, whatever order the client sent.
    lessons: patch.lessons ? renumber(patch.lessons) : current.lessons,
  }));

  return Response.json({ course });
}

function notFound() {
  return Response.json(
    { error: { code: "not_found", message: "No such course." } },
    { status: 404 }
  );
}

function forbidden() {
  return Response.json(
    { error: { code: "forbidden", message: "That isn't your course." } },
    { status: 403 }
  );
}
