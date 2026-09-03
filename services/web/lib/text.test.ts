import { describe, expect, it } from "vitest";

import { firstSentence, slugify, toRoman } from "@/lib/text";

describe("toRoman", () => {
  it.each([
    [1, "I"],
    [4, "IV"],
    [5, "V"],
    [7, "VII"],
    [9, "IX"],
    [10, "X"],
    [14, "XIV"],
  ])("renders %i as %s", (value, expected) => {
    expect(toRoman(value)).toBe(expected);
  });

  it("returns nothing for a non-ordinal", () => {
    expect(toRoman(0)).toBe("");
    expect(toRoman(-3)).toBe("");
    expect(toRoman(Number.NaN)).toBe("");
  });
});

describe("slugify", () => {
  // A twin of Slugify in services/gateway/internal/kb/kb.go. The two must agree,
  // or a knowledge base gets one URL from the server and a different one in a
  // client-side preview.
  it("lowercases and hyphenates", () => {
    expect(slugify("Arun Velasco")).toBe("arun-velasco");
  });

  it("strips punctuation and accents", () => {
    expect(slugify("José Álvarez: what's *actually* true?!")).toBe(
      "jose-alvarez-what-s-actually-true"
    );
  });

  it("never produces a leading, trailing or empty slug", () => {
    expect(slugify("  —  ")).toBe("candidate");
    expect(slugify("!!!")).toBe("candidate");
    expect(slugify("--hi--")).toBe("hi");
  });

  it("truncates without leaving a trailing hyphen", () => {
    const slug = slugify("a".repeat(80));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("firstSentence", () => {
  it("collapses whitespace and leaves short text alone", () => {
    expect(firstSentence("one   two\nthree")).toBe("one two three");
  });

  it("truncates on a word boundary", () => {
    const long = "alpha beta gamma delta epsilon";
    expect(firstSentence(long, 12)).toBe("alpha beta…");
  });
});
