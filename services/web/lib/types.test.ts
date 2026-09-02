import { describe, expect, it } from "vitest";

import { readFixture } from "@/lib/fixture";
import {
  IngestResultSchema,
  KBMetaSchema,
  PRE_ROLL_BULLETS,
  QUIZ_CHOICE_COUNT,
  SELECTED_CHIP_COUNT,
  sectionId,
} from "@/lib/types";

describe("schemas", () => {
  // The fixture is the contract. If a schema change breaks this, either the
  // change is wrong or docs/productDocs/fixtures/expected.json needs updating
  // alongside it — silently diverging from the reference case is the failure
  // mode worth guarding.
  it("parses the reference fixture", async () => {
    const fixture = await readFixture();

    expect(fixture.kb.slug).toBe("arun-velasco");
    expect(fixture.sections.length).toBeGreaterThanOrEqual(10);
    expect(fixture.chips).toHaveLength(8);
    expect(fixture.quiz).toHaveLength(12);
    expect(fixture.pre_roll.bullets).toHaveLength(PRE_ROLL_BULLETS);
  });

  it("the fixture chooses exactly three chips for the front page", async () => {
    const fixture = await readFixture();

    const selected = fixture.chips.filter((chip) => chip.selected);
    expect(selected).toHaveLength(SELECTED_CHIP_COUNT);
  });

  it("every fixture question cites a section that exists", async () => {
    const fixture = await readFixture();
    const ids = new Set(
      fixture.sections.map((section) => sectionId(section.path, section.anchor))
    );

    // Assertion B2, on the same bytes the Go and Python suites check.
    expect(fixture.chips.every((chip) => ids.has(chip.kb_section))).toBe(true);
    expect(fixture.quiz.every((item) => ids.has(item.source_section))).toBe(true);
  });

  it("accepts an ingestion result with the optional fields left out", () => {
    const parsed = IngestResultSchema.safeParse({
      sections: [{ path: "a/one", title: "One" }],
      chips: [{ text: "why did he leave?" }],
      quiz: [
        {
          question: "q",
          choices: ["a", "b", "c", "d"],
          correct_index: 0,
        },
      ],
      pre_roll: {},
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.chips[0].register).toBe("narrative");
    expect(parsed.data?.chips[0].selected).toBe(false);
    expect(parsed.data?.quiz[0].category).toBe("substance");
    expect(parsed.data?.pre_roll.bullets).toEqual([]);
  });

  it("rejects a quiz item the gate could not render", () => {
    // The gate shows four options and scores one. Three is a broken screen, not
    // a weak question, so it never reaches the database.
    const threeOptions = IngestResultSchema.safeParse({
      sections: [],
      chips: [],
      quiz: [{ question: "q", choices: ["a", "b", "c"], correct_index: 0 }],
      pre_roll: {},
    });
    expect(threeOptions.success).toBe(false);

    const badIndex = IngestResultSchema.safeParse({
      sections: [],
      chips: [],
      quiz: [
        {
          question: "q",
          choices: ["a", "b", "c", "d"],
          correct_index: QUIZ_CHOICE_COUNT,
        },
      ],
      pre_roll: {},
    });
    expect(badIndex.success).toBe(false);
  });

  it("rejects a blank name, with the copy the field shows", () => {
    const parsed = KBMetaSchema.safeParse({ title: "   ", tagline: "A line." });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toContain("Your name");
  });

  it("rejects a missing one-liner", () => {
    const parsed = KBMetaSchema.safeParse({ title: "Arun Velasco", tagline: "" });

    expect(parsed.success).toBe(false);
  });
});

describe("sectionId", () => {
  // A twin of SectionID in Go and section_id in Python. Reference resolution is
  // an equality test on the result, so an inconsistent join breaks all of it.
  it("joins a path and an anchor", () => {
    expect(sectionId("agoda/psp-routing", "circuit-breakers")).toBe(
      "agoda/psp-routing#circuit-breakers"
    );
  });

  it("is just the path when there is no anchor", () => {
    expect(sectionId("postgres/opinions", "")).toBe("postgres/opinions");
  });

  it("trims stray separators rather than doubling them", () => {
    expect(sectionId("/postgres/opinions/", "#deferred")).toBe(
      "postgres/opinions#deferred"
    );
  });
});
