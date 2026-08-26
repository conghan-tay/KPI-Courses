import { describe, expect, it } from "vitest";

import { readFixture, readFixtureSource } from "@/lib/ingest/fixture";
import {
  auditAnchors,
  isQuoteAnchored,
  isThinOnPositions,
  normalizeForMatch,
} from "@/lib/quotes";
import type { Position } from "@/lib/types";

function position(overrides: Partial<Position> = {}): Position {
  return { claim: "c", because: "b", pushback: "p", ...overrides };
}

describe("quote anchoring", () => {
  // Assertion A2 from docs/productDocs/fixtures/README.md, and the one check
  // that is a plain string match: every quote must appear in the source. If
  // this ever fails, either the fixture drifted or the matcher got too strict.
  it("anchors all seven fixture quotes in source.md", async () => {
    const [fixture, source] = await Promise.all([
      readFixture(),
      readFixtureSource(),
    ]);

    const report = auditAnchors(fixture.positions, source);

    expect(report.total).toBe(7);
    expect(report.unanchored).toEqual([]);
  });

  it("treats typographic punctuation as equivalent", () => {
    // A model that re-types a quote correctly but straightens the apostrophes
    // has not hallucinated anything.
    const source = "She said “never bill hourly” — and it wasn’t negotiable.";
    expect(
      isQuoteAnchored(`"never bill hourly" - and it wasn't negotiable.`, source)
    ).toBe(true);
  });

  it("collapses whitespace across line breaks", () => {
    const source = "A price objection\n  is almost never\nabout the price.";
    expect(
      isQuoteAnchored("A price objection is almost never about the price.", source)
    ).toBe(true);
  });

  it("rejects a paraphrase", () => {
    const source = "Never lower the price without taking something out of the box.";
    expect(isQuoteAnchored("Never discount without cutting scope.", source)).toBe(
      false
    );
  });

  it("treats a missing quote as unanchored", () => {
    expect(isQuoteAnchored(undefined, "anything")).toBe(false);
    expect(isQuoteAnchored("   ", "anything")).toBe(false);
  });

  it("reports which positions are unanchored, by index", () => {
    const report = auditAnchors(
      [
        position({ quote: "in the source" }),
        position({ quote: "nowhere to be found" }),
        position({}),
      ],
      "a line that is in the source somewhere"
    );

    expect(report.unanchored).toEqual([1, 2]);
    expect(report.anchored).toBe(1);
  });

  it("normalises case so a re-capitalised quote still matches", () => {
    expect(normalizeForMatch("  Hold   THE  Number ")).toBe("hold the number");
  });
});

describe("thin positions", () => {
  // "fewer than 3 positions found → warn but allow publish"
  it.each([
    [0, true],
    [2, true],
    [3, false],
    [7, false],
  ])("with %i positions is thin: %s", (count, expected) => {
    const positions = Array.from({ length: count }, () => position());
    expect(isThinOnPositions(positions)).toBe(expected);
  });
});
