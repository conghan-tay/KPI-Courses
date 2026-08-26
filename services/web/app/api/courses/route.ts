import { courseStore } from "@/lib/store";
import { toSummary } from "@/lib/serialize";
import { getCurrentUser } from "@/lib/session";

/** GET /api/courses — the studio list. Scoped to the signed-in Specialist. */
export async function GET() {
  const user = await getCurrentUser();
  const courses = await courseStore.list(user.id);
  return Response.json({ courses: courses.map(toSummary) });
}
