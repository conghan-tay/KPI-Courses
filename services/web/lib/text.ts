const ROMAN: [number, string][] = [
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

/**
 * DESIGN.md §4.8 — the syllabus rail numbers lessons in roman. Courses are
 * 5–9 lessons, so this never needs to reach past a couple of dozen.
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

/** URL-safe slug for /c/:slug. Collisions are resolved by the store. */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "course";
}

/** `34900` → `$349`. Prices are whole dollars in this POC. */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

/** First N words, for the one-line preview of a long body. */
export function firstSentence(input: string, max = 140): string {
  const flat = input.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).replace(/\s+\S*$/, "")}…`;
}
