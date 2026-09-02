const ROMAN: [number, string][] = [
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

/**
 * DESIGN.md §4.8 — the section index numbers in roman. A knowledge base is
 * 8–16 sections, so this never needs to reach far past twenty.
 */
export function toRoman(value: number): string {
  if (!Number.isFinite(value) || value < 1) return "";
  let remaining = Math.floor(value);
  let out = "";
  for (const [amount, numeral] of ROMAN) {
    while (remaining >= amount) {
      out += numeral;
      remaining -= amount;
    }
  }
  return out;
}

/**
 * URL-safe slug for /k/:slug. Collisions are resolved by the store.
 *
 * Mirrors Slugify in services/gateway/internal/kb/kb.go step for step — NFKD,
 * drop combining marks, lowercase, collapse to hyphens, trim, truncate, trim
 * again — so a knowledge base keeps the same URL whichever side computed it.
 */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "candidate";
}

/** First N words, for the one-line preview of a long body. */
export function firstSentence(input: string, max = 140): string {
  const flat = input.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).replace(/\s+\S*$/, "")}…`;
}
