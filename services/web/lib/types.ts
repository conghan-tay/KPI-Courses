import { z } from "zod";

// The shape of a course, as POC_UserJourney.md §1 defines it, with three
// additions that the fixture and the failure states force. Each is called out
// below so the divergence from the spec is deliberate and visible.
//
// docs/productDocs/fixtures/expected.json must parse against these schemas —
// see lib/__tests__/types.test.ts.

/**
 * A stance the Specialist will defend. This is the paid asset: `claim` is the
 * hook, `because` is the argument, and `pushback` is the thing a book cannot
 * do — it only fires when the Seeker personally objects.
 */
export const PositionSchema = z.object({
  claim: z.string().min(1),
  because: z.string().min(1),
  pushback: z.string().min(1),
  /**
   * DIVERGENCE 1: not in the POC schema, but the ingestion prompt says
   * "quote-anchor every position to the source text" and the fixture carries
   * one. It is the hallucination canary — see isQuoteAnchored in lib/quotes.ts.
   */
  quote: z.string().optional(),
});

export const VoiceCardSchema = z.object({
  register: z.string().default(""),
  pet_peeves: z.array(z.string()).default([]),
  signature_moves: z.array(z.string()).default([]),
  /** DIVERGENCE 2: in the fixture, absent from the POC sketch. */
  refuses_to: z.array(z.string()).default([]),
});

export const LessonSchema = z.object({
  ord: z.number().int().positive(),
  title: z.string().min(1),
  /** A capability ("can size a market from three numbers"), never a topic. */
  objective: z.string().default(""),
  key_points: z.array(z.string()).default([]),
  body_md: z.string().default(""),
});

export const CourseStatusSchema = z.enum(["draft", "published"]);

/**
 * DIVERGENCE 3: the POC data model has no ingestion state, but the spec
 * requires "ingestion timeout → keep the draft, offer retry". The draft row is
 * written before the model call, so a failure leaves something to retry.
 */
export const IngestStatusSchema = z.enum(["running", "ready", "failed"]);

export const CourseSchema = z.object({
  id: z.string(),
  specialist_id: z.string(),
  specialist_name: z.string(),
  specialist_bio: z.string().default(""),
  slug: z.string(),
  title: z.string(),
  tagline: z.string().default(""),
  price_cents: z.number().int().nonnegative(),
  status: CourseStatusSchema,
  ingest_status: IngestStatusSchema,
  ingest_error: z.string().optional(),
  voice_card: VoiceCardSchema,
  positions: z.array(PositionSchema),
  lessons: z.array(LessonSchema),
  /** The full raw text. No RAG: at this size the whole thing is the prompt. */
  source_text: z.string(),
  source_files: z.array(z.string()).default([]),
  created_at: z.string(),
  updated_at: z.string(),
});

/** What the ingestion model is asked to return, and nothing more. */
export const IngestResultSchema = z.object({
  lessons: z.array(LessonSchema.omit({ ord: true }).extend({
    ord: z.number().int().positive().optional(),
  })),
  voice_card: VoiceCardSchema,
  positions: z.array(PositionSchema),
});

/** The fixture file, which carries course metadata alongside the model output. */
export const FixtureSchema = IngestResultSchema.extend({
  course: z.object({
    slug: z.string(),
    title: z.string(),
    tagline: z.string(),
    price_cents: z.number().int(),
    status: CourseStatusSchema,
  }),
});

export const CourseMetaSchema = z.object({
  title: z.string().trim().min(1, "Give the course a title."),
  tagline: z.string().trim().min(1, "One line. What does this get them?"),
  price_cents: z
    .number()
    .int()
    .positive("Enter a number in dollars. Free courses can't be published yet."),
});

/** A partial edit from the review screen. Every field is independently saveable. */
export const CoursePatchSchema = z.object({
  title: z.string().trim().min(1).optional(),
  tagline: z.string().trim().optional(),
  price_cents: z.number().int().nonnegative().optional(),
  lessons: z.array(LessonSchema).optional(),
  positions: z.array(PositionSchema).optional(),
  voice_card: VoiceCardSchema.optional(),
});

export type Position = z.infer<typeof PositionSchema>;
export type VoiceCard = z.infer<typeof VoiceCardSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type Course = z.infer<typeof CourseSchema>;
export type CourseStatus = z.infer<typeof CourseStatusSchema>;
export type IngestStatus = z.infer<typeof IngestStatusSchema>;
export type IngestResult = z.infer<typeof IngestResultSchema>;
export type CourseMeta = z.infer<typeof CourseMetaSchema>;
export type CoursePatch = z.infer<typeof CoursePatchSchema>;

/** A course as the catalog and the studio list see it — no bodies, no stances. */
export type CourseSummary = Pick<
  Course,
  | "id"
  | "slug"
  | "title"
  | "tagline"
  | "price_cents"
  | "status"
  | "ingest_status"
  | "specialist_name"
  | "created_at"
  | "updated_at"
> & { lesson_count: number; position_count: number };

/**
 * Everything a stranger is allowed to see, and nothing else — an allowlist, so
 * a field added to `Course` later is withheld by default rather than leaked by
 * default. See lib/serialize.ts and DESIGN.md §4.5.
 */
export type PublicCourse = Pick<
  Course,
  | "id"
  | "slug"
  | "title"
  | "tagline"
  | "price_cents"
  | "status"
  | "specialist_name"
  | "specialist_bio"
> & {
  positions: Pick<Position, "claim">[];
  lessons: Pick<Lesson, "ord" | "title" | "objective">[];
};

/** Server-sent events emitted by POST /api/courses/ingest. */
export type IngestEvent =
  | { type: "status"; message: string }
  | { type: "draft"; course_id: string }
  | { type: "result"; course_id: string }
  | { type: "error"; code: string; message: string; course_id?: string };
