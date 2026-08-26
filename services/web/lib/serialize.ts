import type { Course, CourseSummary, PublicCourse } from "@/lib/types";

/**
 * DESIGN.md §4.5, and it is engineering rather than styling:
 *
 * > do not render the real text and blur it with CSS. `GET /api/courses/:slug`
 * > must omit `because` and `pushback` for unauthenticated requests.
 *
 * The whole conversion mechanic depends on the argument being withheld, and a
 * `filter: blur()` is one devtools inspection away from giving it away. So the
 * projection lives on the server and the locked card simply has nothing to
 * render. Journey 2's course page inherits this function unchanged.
 *
 * This is an allowlist, deliberately. An omit-list leaks every field anyone
 * adds to `Course` later — including `voice_card`, which is the persona spec
 * the sample chat runs on and has no business in a stranger's browser.
 */
export function toPublicCourse(course: Course): PublicCourse {
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    tagline: course.tagline,
    price_cents: course.price_cents,
    status: course.status,
    specialist_name: course.specialist_name,
    specialist_bio: course.specialist_bio,
    // The claim is the hook and is meant to be read by a stranger. The
    // argument, the counter-argument and the source quote are the product.
    positions: course.positions.map((position) => ({ claim: position.claim })),
    // Objectives sell the syllabus; bodies and key points are the course.
    lessons: course.lessons.map((lesson) => ({
      ord: lesson.ord,
      title: lesson.title,
      objective: lesson.objective,
    })),
  };
}

export function toSummary(course: Course): CourseSummary {
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    tagline: course.tagline,
    price_cents: course.price_cents,
    status: course.status,
    ingest_status: course.ingest_status,
    specialist_name: course.specialist_name,
    created_at: course.created_at,
    updated_at: course.updated_at,
    lesson_count: course.lessons.length,
    position_count: course.positions.length,
  };
}
