import type { Position } from "@/lib/types";

/**
 * Assertion A2 from docs/productDocs/fixtures/README.md, running in the product
 * rather than only in a test: every `positions[].quote` must appear in the
 * source text. It is the one check that is a plain string match, and it is the
 * highest-value one — a position with no anchor is a position the model may
 * have invented, and a tutor that argues an invented stance in the
 * Specialist's voice damages the Specialist.
 *
 * Typography is normalised before comparing (curly quotes, en/em dashes,
 * collapsed whitespace) because a model that re-types a quote correctly but
 * straightens an apostrophe has not hallucinated anything.
 */
export function normalizeForMatch(input: string): string {
  return input
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isQuoteAnchored(
  quote: string | undefined,
  sourceText: string
): boolean {
  if (!quote?.trim()) return false;
  return normalizeForMatch(sourceText).includes(normalizeForMatch(quote));
}

export type AnchorReport = {
  /** Indexes into `positions` whose quote is missing or not found in source. */
  unanchored: number[];
  anchored: number;
  total: number;
};

export function auditAnchors(
  positions: Position[],
  sourceText: string
): AnchorReport {
  const unanchored = positions
    .map((position, index) =>
      isQuoteAnchored(position.quote, sourceText) ? -1 : index
    )
    .filter((index) => index >= 0);

  return {
    unanchored,
    anchored: positions.length - unanchored.length,
    total: positions.length,
  };
}

/**
 * POC_UserJourney.md — "fewer than 3 positions found → warn but allow publish".
 * Below this line the review screen defaults to Syllabus and reframes itself
 * around where students get stuck, rather than telling a perfectly good
 * Specialist that their opinions aren't interesting.
 */
export const THIN_POSITIONS_THRESHOLD = 3;

export function isThinOnPositions(positions: Position[]): boolean {
  return positions.length < THIN_POSITIONS_THRESHOLD;
}
