import { describe, expect, it } from "vitest";

import { readFixture } from "@/lib/ingest/fixture";
import { CourseMetaSchema, IngestResultSchema } from "@/lib/types";

describe("schemas", () => {
  // The fixture is the contract. If a schema change breaks this, either the
  // change is wrong or docs/productDocs/fixtures/expected.json needs updating
  // alongside it — silently diverging from the reference case is the failure
  // mode worth guarding.
  it("parses the reference fixture", async () => {
    const fixture = await readFixture();

    expect(fixture.course.slug).toBe("hold-your-number");
    expect(fixture.lessons).toHaveLength(7);
    expect(fixture.positions).toHaveLength(7);
    expect(fixture.voice_card.pet_peeves.length).toBeGreaterThan(0);
    // `refuses_to` is in the fixture but not in the POC voice_card sketch.
    expect(fixture.voice_card.refuses_to.length).toBeGreaterThan(0);
    // Every position carries the quote the ingestion prompt asks for.
    expect(fixture.positions.every((p) => p.quote)).toBe(true);
  });

  it("accepts an ingestion result with no quotes and no voice fields", () => {
    const parsed = IngestResultSchema.safeParse({
      lessons: [
        { title: "One", objective: "Can do the thing", key_points: [], body_md: "" },
      ],
      voice_card: {},
      positions: [{ claim: "c", because: "b", pushback: "p" }],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.voice_card.refuses_to).toEqual([]);
  });

  it("rejects a course with no price, with the copy the field shows", () => {
    const parsed = CourseMetaSchema.safeParse({
      title: "Hold Your Number",
      tagline: "A line.",
      price_cents: 0,
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toContain(
      "Free courses can't be published yet"
    );
  });

  it("rejects a blank title", () => {
    const parsed = CourseMetaSchema.safeParse({
      title: "   ",
      tagline: "A line.",
      price_cents: 100,
    });

    expect(parsed.success).toBe(false);
  });
});
