import { publishBlockers } from "@/lib/courses";
import { courseStore } from "@/lib/store";
import { getCurrentUser } from "@/lib/session";

/**
 * POST /api/courses/:id/publish
 *
 * Thin positions warn but never block — POC_UserJourney.md is explicit that a
 * Specialist with two stances and forty pages of craft still has a course
 * worth selling.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/courses/[id]/publish">
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

  const blockers = publishBlockers(course);
  if (blockers.length > 0) {
    return Response.json(
      {
        error: {
          code: "not_publishable",
          message: blockers[0],
          blockers,
        },
      },
      { status: 409 }
    );
  }

  const published = await courseStore.update(id, (current) => ({
    ...current,
    status: "published",
  }));

  return Response.json({
    course: published,
    url: `/c/${published!.slug}`,
  });
}
