import { z } from "zod";

// The shape of a knowledge base, as POC_UserJourney.md §1 defines it.
//
// These schemas are one third of a three-way contract: the Go structs in
// services/gateway/internal/api/types.go and the Pydantic models in
// services/agent/app/core/kb_schemas.py carry the same field names, and
// nothing enforces the agreement at build time.
//
// docs/productDocs/fixtures/expected.json must parse against these schemas —
// see lib/types.test.ts.

/** Exactly four options, always. The gate renders four and scores one. */
export const QUIZ_CHOICE_COUNT = 4;

/** Eight chips are generated; the candidate picks this many for the front page. */
export const SELECTED_CHIP_COUNT = 3;

/** One headline plus this many bullets — what pre_roll_wireframe.txt is drawn for. */
export const PRE_ROLL_BULLETS = 4;

/**
 * A section is addressed as `path`, or `path#anchor`. That id is what every
 * chip and quiz item resolves against, so it is computed in one place here,
 * mirroring SectionID() in Go and section_id() in Python.
 */
export function sectionId(path: string, anchor: string): string {
  const cleanPath = path.trim().replace(/^[#/]+|[#/]+$/g, "");
  const cleanAnchor = anchor.trim().replace(/^#+|#+$/g, "");
  return cleanAnchor ? `${cleanPath}#${cleanAnchor}` : cleanPath;
}

export const SectionSchema = z.object({
  ord: z.number().int().positive(),
  path: z.string().min(1),
  anchor: z.string().default(""),
  title: z.string().min(1),
  /** One or two sentences that stand alone — Journey 2 prompts on summaries. */
  summary: z.string().default(""),
  body_md: z.string().default(""),
  source_names: z.array(z.string()).default([]),
});

export const ChipRegisterSchema = z.enum(["skeptical", "narrative", "blunt"]);

/**
 * One opening question a recruiter would type first. `kb_section` is the
 * hallucination canary — it must resolve to a real section id, and one that
 * does not is cleared rather than shipped as a fabricated citation. See
 * isRefResolved in lib/refs.ts.
 */
export const ChipSchema = z.object({
  text: z.string().min(1),
  kb_section: z.string().default(""),
  register: ChipRegisterSchema.default("narrative"),
  selected: z.boolean().default(false),
  /** The candidate's private reasoning. Withheld from the public projection. */
  why_it_lands: z.string().default(""),
});

export const QuizCategorySchema = z.enum([
  "motivation",
  "judgement",
  "limits",
  "substance",
]);

export const QuizItemSchema = z.object({
  id: z.string().default(""),
  category: QuizCategorySchema.default("substance"),
  question: z.string().min(1),
  choices: z.array(z.string().min(1)).length(QUIZ_CHOICE_COUNT),
  correct_index: z
    .number()
    .int()
    .min(0)
    .max(QUIZ_CHOICE_COUNT - 1),
  /** For the candidate reviewing their own quiz. Never sent to a recruiter. */
  rationale: z.string().default(""),
  source_section: z.string().default(""),
});

export const PreRollSchema = z.object({
  headline: z.string().default(""),
  bullets: z.array(z.string()).max(PRE_ROLL_BULLETS).default([]),
});

export const KBStatusSchema = z.enum(["draft", "published"]);

/**
 * The POC data model needs an ingestion state because the spec requires
 * "ingestion timeout → keep the draft, offer retry". The draft row is written
 * before the model call, so a failure leaves something to retry.
 */
export const IngestStatusSchema = z.enum(["running", "ready", "failed"]);

export const KnowledgeBaseSchema = z.object({
  id: z.string(),
  candidate_id: z.string(),
  candidate_name: z.string(),
  candidate_bio: z.string().default(""),
  slug: z.string(),
  /** The candidate's display name, and the one line under it. No price: §0. */
  title: z.string(),
  tagline: z.string().default(""),
  status: KBStatusSchema,
  ingest_status: IngestStatusSchema,
  ingest_error: z.string().optional(),
  pre_roll: PreRollSchema,
  chips: z.array(ChipSchema),
  quiz: z.array(QuizItemSchema),
  sections: z.array(SectionSchema),
  /** The full raw text. No RAG: at this size the whole thing is the prompt. */
  source_text: z.string(),
  source_files: z.array(z.string()).default([]),
  created_at: z.string(),
  updated_at: z.string(),
});

/** What the ingestion pipeline is asked to return, and nothing more. */
export const IngestResultSchema = z.object({
  sections: z.array(
    SectionSchema.omit({ ord: true }).extend({
      ord: z.number().int().positive().optional(),
    })
  ),
  chips: z.array(ChipSchema),
  quiz: z.array(QuizItemSchema),
  pre_roll: PreRollSchema,
});

/** The fixture file, which carries KB metadata alongside the pipeline output. */
export const FixtureSchema = IngestResultSchema.extend({
  kb: z.object({
    slug: z.string(),
    title: z.string(),
    tagline: z.string(),
    status: KBStatusSchema,
  }),
});

export const KBMetaSchema = z.object({
  title: z.string().trim().min(1, "Your name, as a recruiter should see it."),
  tagline: z.string().trim().min(1, "One line. Who are you, in about ten words?"),
});

/** A partial edit from the review screen. Every field is independently saveable. */
export const KBPatchSchema = z.object({
  title: z.string().trim().min(1).optional(),
  tagline: z.string().trim().optional(),
  sections: z.array(SectionSchema).optional(),
  chips: z.array(ChipSchema).optional(),
  quiz: z.array(QuizItemSchema).optional(),
  pre_roll: PreRollSchema.optional(),
});

export type Section = z.infer<typeof SectionSchema>;
export type Chip = z.infer<typeof ChipSchema>;
export type ChipRegister = z.infer<typeof ChipRegisterSchema>;
export type QuizItem = z.infer<typeof QuizItemSchema>;
export type QuizCategory = z.infer<typeof QuizCategorySchema>;
export type PreRoll = z.infer<typeof PreRollSchema>;
export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;
export type KBStatus = z.infer<typeof KBStatusSchema>;
export type IngestStatus = z.infer<typeof IngestStatusSchema>;
export type IngestResult = z.infer<typeof IngestResultSchema>;
export type KBMeta = z.infer<typeof KBMetaSchema>;
export type KBPatch = z.infer<typeof KBPatchSchema>;

/** A knowledge base as the studio list sees it — no bodies, no quiz, no chips. */
export type KBSummary = Pick<
  KnowledgeBase,
  | "id"
  | "slug"
  | "title"
  | "tagline"
  | "status"
  | "ingest_status"
  | "candidate_name"
  | "created_at"
  | "updated_at"
> & { section_count: number; chip_count: number; quiz_count: number };

/**
 * Everything a stranger is allowed to see, and nothing else — an allowlist, so
 * a field added to `KnowledgeBase` later is withheld by default rather than
 * leaked by default. Applied server-side by the Go API.
 *
 * The quiz is absent, and that is the point: it gates booking real time, and a
 * leaked `correct_index` makes it a formality.
 */
export type PublicKB = Pick<
  KnowledgeBase,
  | "id"
  | "slug"
  | "title"
  | "tagline"
  | "status"
  | "candidate_name"
  | "candidate_bio"
  | "pre_roll"
> & {
  chips: Pick<Chip, "text">[];
  sections: Pick<Section, "ord" | "title" | "summary">[];
};

/** Server-sent events emitted by POST /api/kb/ingest. */
export type IngestEvent =
  | { type: "status"; message: string }
  | { type: "draft"; kb_id: string }
  | { type: "result"; kb_id: string }
  | { type: "error"; code: string; message: string; kb_id?: string };
