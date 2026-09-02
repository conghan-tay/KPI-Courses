import { sectionId, type Chip, type QuizItem, type Section } from "@/lib/types";

/**
 * Assertion B2 from docs/productDocs/fixtures/README.md, running in the product
 * rather than only in a test: every `chips[].kb_section` and every
 * `quiz[].source_section` must name a section that exists.
 *
 * It is the one check that is a plain string comparison, and it is the
 * highest-value one — a chip pointing at nothing is a chip the model may have
 * invented, and an agent citing a section that was never written misrepresents
 * the candidate to a recruiter, in the candidate's name.
 *
 * This is a deliberate twin of normalize_ref/unresolved_indexes in
 * services/agent/app/graph/refs.py. The pipeline clears a reference it cannot
 * resolve, so a fresh knowledge base has none — but the candidate can delete a
 * section out from under a chip on the review screen, and that is exactly when
 * the warning has to appear.
 *
 * Normalisation is narrow on purpose: case, surrounding whitespace, and stray
 * separators, and nothing else. Ids are slugs. A reference that differs by more
 * than that is a different reference, and treating it as a match would be the
 * false confidence this check exists to prevent.
 */
export function normalizeRef(input: string): string {
  return input
    .replace(/^[#/\s]+|[#/\s]+$/g, "")
    .trim()
    .toLowerCase();
}

/** Every section id in a knowledge base, normalised for comparison. */
export function sectionIdSet(sections: Section[]): Set<string> {
  return new Set(
    sections.map((section) =>
      normalizeRef(sectionId(section.path, section.anchor))
    )
  );
}

/**
 * True when `ref` names a section that is actually there. An empty reference is
 * not resolved — "no source" and "a source that does not exist" are the same
 * thing from a reader's point of view, and both deserve the same warning.
 */
export function isRefResolved(
  ref: string | undefined,
  known: Set<string>
): boolean {
  if (!ref?.trim()) return false;
  return known.has(normalizeRef(ref));
}

export type RefReport = {
  /** Indexes into `chips` whose `kb_section` names nothing. */
  chips: number[];
  /** Indexes into `quiz` whose `source_section` names nothing. */
  quiz: number[];
  resolved: number;
  total: number;
};

export function auditRefs(
  sections: Section[],
  chips: Chip[],
  quiz: QuizItem[]
): RefReport {
  const known = sectionIdSet(sections);
  const unresolvedChips = chips
    .map((chip, index) => (isRefResolved(chip.kb_section, known) ? -1 : index))
    .filter((index) => index >= 0);
  const unresolvedQuiz = quiz
    .map((item, index) =>
      isRefResolved(item.source_section, known) ? -1 : index
    )
    .filter((index) => index >= 0);

  const total = chips.length + quiz.length;
  return {
    chips: unresolvedChips,
    quiz: unresolvedQuiz,
    resolved: total - unresolvedChips.length - unresolvedQuiz.length,
    total,
  };
}

/**
 * Fixture assertion B6. Eight chips is the target and three are selected for the
 * front page. Below the target the review screen warns; it never blocks, because
 * a candidate with a sparse corpus still has a knowledge base worth publishing.
 */
export const TARGET_CHIPS = 8;

export function isThinOnChips(chips: Chip[]): boolean {
  return chips.length < TARGET_CHIPS;
}

/** Fixture assertion B7: twelve items, three per category. */
export const TARGET_QUIZ_ITEMS = 12;
export const QUIZ_PER_CATEGORY = 3;

/**
 * B8, as a warning rather than a filter.
 *
 * quiz_example_prompt.txt says to delete any question whose answer is a number —
 * it is answerable by ctrl-F, so it tests recall rather than comprehension. The
 * pipeline flags these instead of dropping them, because silently deleting a
 * candidate's question is worse than a warning they are free to ignore, and this
 * is where that warning gets rendered.
 *
 * A twin of looks_ctrl_f_answerable in services/agent/app/graph/refs.py.
 */
const BARE_QUANTITY =
  /^(about|roughly|approximately|~)?\s*([\d.,]+\s*[%a-z]{0,3}|one|two|three|four|five|six|seven|eight|nine|ten)$/;

export function looksCtrlFAnswerable(item: QuizItem): boolean {
  const answer = item.choices[item.correct_index];
  if (answer === undefined) return false;
  return BARE_QUANTITY.test(answer.trim().toLowerCase());
}
