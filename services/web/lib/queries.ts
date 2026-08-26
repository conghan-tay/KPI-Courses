import { courseStore } from "@/lib/store";
import { getCurrentUser } from "@/lib/session";
import { toSummary } from "@/lib/serialize";
import type { Course, CourseSummary } from "@/lib/types";

/**
 * Server-side reads.
 *
 * Server Components read the store directly rather than fetching this app's own
 * route handlers — a server fetching itself is a round trip that buys nothing.
 * Mutations and streams go through lib/api-client.ts from the browser. Those
 * two files are the whole data seam: repointing at the Go gateway means
 * changing them and nothing in `app/` or `components/`.
 */

export async function listMyCourses(): Promise<CourseSummary[]> {
  const user = await getCurrentUser();
  const courses = await courseStore.list(user.id);
  return courses.map(toSummary);
}

/** Null covers both "no such course" and "not yours" — the screen 404s either way. */
export async function getMyCourse(id: string): Promise<Course | null> {
  const user = await getCurrentUser();
  const course = await courseStore.get(id);
  if (!course || course.specialist_id !== user.id) return null;
  return course;
}
