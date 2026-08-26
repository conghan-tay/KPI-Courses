import { ingestMode, softenClaim } from "@/lib/ingest";
import { courseStore } from "@/lib/store";
import { getCurrentUser } from "@/lib/session";
import { updatePosition } from "@/lib/reducers";

/**
 * POST /api/courses/:id/positions/:index/soften
 *
 * `Soften` from POC_UserJourney.md's review screen. It only means anything with
 * a model behind it, so in mock mode this reports `unavailable` and the card
 * falls back to inline editing — the button is never dead, and it never
 * silently pretends to have rewritten something.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/courses/[id]/positions/[index]/soften">
) {
  const { id, index } = await ctx.params;
  const position = Number(index);

  if (ingestMode() !== "live") {
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "Softening needs a model. Edit the claim yourself, or set INGEST_MODE=live.",
        },
      },
      { status: 501 }
    );
  }

  const course = await courseStore.get(id);
  if (!course || !course.positions[position]) {
    return Response.json(
      { error: { code: "not_found", message: "No such position." } },
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

  let claim: string;
  try {
    claim = await softenClaim(course.positions[position].claim);
  } catch (error) {
    return Response.json(
      {
        error: {
          code: "model_error",
          message: error instanceof Error ? error.message : "The rewrite failed.",
        },
      },
      { status: 502 }
    );
  }

  const updated = await courseStore.update(id, (current) => ({
    ...current,
    positions: updatePosition(current.positions, position, { claim }),
  }));

  return Response.json({ course: updated });
}
