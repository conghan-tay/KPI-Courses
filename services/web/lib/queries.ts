import { GatewayRequestError, gatewayJson } from "@/lib/gateway";
import type { Course, CourseSummary } from "@/lib/types";

/**
 * Server-side reads.
 *
 * Server Components call the Go API directly rather than fetching this app's own
 * route handlers — a server fetching itself to reach a third server is a round
 * trip that buys nothing. Mutations and streams go through lib/api-client.ts
 * from the browser, which hits the proxies in app/api/courses/*.
 *
 * Those two files plus lib/gateway.ts are the whole data seam. Nothing in
 * `app/` or `components/` knows the gateway exists.
 */

export async function listMyCourses(): Promise<CourseSummary[]> {
  const { courses } = await gatewayJson<{ courses: CourseSummary[] }>(
    "/v1/courses"
  );
  return courses;
}

/**
 * Null covers "no such course", "not yours", and "the gateway said no" — the
 * screen 404s for all of them. A gateway that is *down* is a different thing and
 * throws, so an outage surfaces as an error page rather than as a studio that
 * quietly claims your course does not exist.
 */
export async function getMyCourse(id: string): Promise<Course | null> {
  try {
    const { course } = await gatewayJson<{ course: Course }>(
      `/v1/courses/${encodeURIComponent(id)}`
    );
    return course;
  } catch (error) {
    if (
      error instanceof GatewayRequestError &&
      (error.status === 404 || error.status === 403)
    ) {
      return null;
    }
    throw error;
  }
}
