import { describe, expect, it } from "vitest";

import { formatPrice, slugify, toRoman } from "@/lib/text";

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
  it("lowercases and hyphenates", () => {
    expect(slugify("Hold Your Number")).toBe("hold-your-number");
  });

  it("strips punctuation and accents", () => {
    expect(slugify("Précis: what's *actually* true?!")).toBe(
      "precis-what-s-actually-true"
    );
  });

  it("never produces a leading, trailing or empty slug", () => {
    expect(slugify("  —  ")).toBe("course");
    expect(slugify("!!!")).toBe("course");
    expect(slugify("--hi--")).toBe("hi");
  });

  it("truncates without leaving a trailing hyphen", () => {
    const slug = slugify("a".repeat(80));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("formatPrice", () => {
  it("shows whole dollars without decimals", () => {
    expect(formatPrice(34900)).toBe("$349");
  });

  it("keeps cents when they exist", () => {
    expect(formatPrice(34950)).toBe("$349.50");
  });
});
