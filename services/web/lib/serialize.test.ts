import { describe, expect, it } from "vitest";

import { toPublicCourse, toSummary } from "@/lib/serialize";
import type { Course } from "@/lib/types";

const course: Course = {
  id: "course-1",
  specialist_id: "user-dana",
  specialist_name: "Dana Mercado",
  specialist_bio: "Bio.",
  slug: "hold-your-number",
  title: "Hold Your Number",
  tagline: "A line.",
  price_cents: 34900,
  status: "published",
  ingest_status: "ready",
  voice_card: {
    register: "Flat and declarative.",
    pet_peeves: [],
    signature_moves: [],
    refuses_to: [],
  },
  positions: [
    {
      claim: "A price objection is almost never about the price.",
      because: "The failure happened weeks earlier.",
      pushback: "But they said it was too expensive → they said the polite thing.",
      quote: "A price objection is almost never about the price.",
    },
  ],
  lessons: [
    {
      ord: 1,
      title: "The objection you hear",
      objective: "Can place the failure in one of two places",
      key_points: ["Ask what they compared it to"],
      body_md: "Every pricing problem arrives disguised as a pricing problem.",
    },
  ],
  source_text: "the entire raw corpus",
  source_files: ["source.md"],
  created_at: "2026-08-25T00:00:00.000Z",
  updated_at: "2026-08-25T00:00:00.000Z",
};

describe("toPublicCourse", () => {
  // DESIGN.md §4.5 — the conversion mechanic depends on the argument being
  // withheld, and withholding has to happen here rather than in CSS. This test
  // is the guard on that: if any of these ever come back, the product is
  // being given away.
  it("sends the claim and withholds the argument", () => {
    const publicCourse = toPublicCourse(course);

    expect(publicCourse.positions).toEqual([
      { claim: "A price objection is almost never about the price." },
    ]);

    const serialized = JSON.stringify(publicCourse);
    expect(serialized).not.toContain("The failure happened weeks earlier");
    expect(serialized).not.toContain("the polite thing");
  });

  it("sends objectives and withholds lesson bodies and key points", () => {
    const publicCourse = toPublicCourse(course);

    expect(publicCourse.lessons).toEqual([
      {
        ord: 1,
        title: "The objection you hear",
        objective: "Can place the failure in one of two places",
      },
    ]);

    const serialized = JSON.stringify(publicCourse);
    expect(serialized).not.toContain("Every pricing problem arrives");
    expect(serialized).not.toContain("Ask what they compared it to");
  });

  it("never leaks the source corpus", () => {
    expect(JSON.stringify(toPublicCourse(course))).not.toContain(
      "the entire raw corpus"
    );
  });

  // The voice card is the persona spec the sample chat runs on. It is not page
  // content and it has no business in a stranger's browser.
  it("withholds the voice card", () => {
    expect(toPublicCourse(course)).not.toHaveProperty("voice_card");
    expect(JSON.stringify(toPublicCourse(course))).not.toContain(
      "Flat and declarative"
    );
  });

  // The allowlist is the guarantee: anything added to Course later is withheld
  // until someone deliberately adds it here.
  it("emits exactly the allowlisted keys", () => {
    expect(Object.keys(toPublicCourse(course)).sort()).toEqual([
      "id",
      "lessons",
      "positions",
      "price_cents",
      "slug",
      "specialist_bio",
      "specialist_name",
      "status",
      "tagline",
      "title",
    ]);
  });

  it("keeps what the course page needs to sell", () => {
    const publicCourse = toPublicCourse(course);
    expect(publicCourse.title).toBe("Hold Your Number");
    expect(publicCourse.price_cents).toBe(34900);
    expect(publicCourse.specialist_name).toBe("Dana Mercado");
  });
});

describe("toSummary", () => {
  it("counts lessons and stances for the studio table", () => {
    const summary = toSummary(course);
    expect(summary.lesson_count).toBe(1);
    expect(summary.position_count).toBe(1);
    expect(summary).not.toHaveProperty("source_text");
  });
});
