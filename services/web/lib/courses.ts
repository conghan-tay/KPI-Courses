import { newCourseId } from "@/lib/store";
import { slugify } from "@/lib/text";
import type { Course, CourseMeta, IngestResult, Lesson } from "@/lib/types";
import type { User } from "@/lib/seed";

/**
 * The draft is written before the model is called, which is what makes
 * "ingestion timeout → keep the draft, offer retry" possible. A row in
 * `ingest_status: "running"` is a course that exists and has no lessons yet.
 */
export function newDraftCourse(input: {
  user: User;
  meta: CourseMeta;
  sourceText: string;
  sourceFiles: string[];
}): Course {
  const now = new Date().toISOString();

  return {
    id: newCourseId(),
    specialist_id: input.user.id,
    specialist_name: input.user.name,
    specialist_bio: input.user.bio,
    slug: slugify(input.meta.title),
    title: input.meta.title,
    tagline: input.meta.tagline,
    price_cents: input.meta.price_cents,
    status: "draft",
    ingest_status: "running",
    voice_card: {
      register: "",
      pet_peeves: [],
      signature_moves: [],
      refuses_to: [],
    },
    positions: [],
    lessons: [],
    source_text: input.sourceText,
    source_files: input.sourceFiles,
    created_at: now,
    updated_at: now,
  };
}

/** The model may omit `ord`; ordinals are ours to assign either way. */
export function applyIngestResult(
  course: Course,
  result: IngestResult
): Course {
  const lessons: Lesson[] = result.lessons.map((lesson, index) => ({
    ord: index + 1,
    title: lesson.title,
    objective: lesson.objective,
    key_points: lesson.key_points,
    body_md: lesson.body_md,
  }));

  return {
    ...course,
    lessons,
    positions: result.positions,
    voice_card: result.voice_card,
    ingest_status: "ready",
    ingest_error: undefined,
  };
}

export function markIngestFailed(course: Course, message: string): Course {
  return { ...course, ingest_status: "failed", ingest_error: message };
}

/** What must be true before a course can be made public. */
export function publishBlockers(course: Course): string[] {
  const blockers: string[] = [];
  if (!course.title.trim()) blockers.push("The course needs a title.");
  if (!course.tagline.trim()) {
    blockers.push("The course needs a tagline — one line, about ten words.");
  }
  if (course.price_cents <= 0) {
    blockers.push("Set a price. Free courses can't be published yet.");
  }
  if (course.lessons.length === 0) {
    blockers.push("A course with no lessons has nothing to teach.");
  }
  if (course.ingest_status === "running") {
    blockers.push("Ingestion is still running.");
  }
  return blockers;
}
