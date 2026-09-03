import { describe, expect, it } from "vitest";

import {
  countByCategory,
  countSelected,
  deleteChip,
  deleteQuizItem,
  deleteSection,
  emptyChip,
  emptyQuizItem,
  emptySection,
  mergeSectionUp,
  moveSection,
  splitPoints,
  splitSection,
  toggleChip,
  updateChip,
  updateQuizChoice,
  updateQuizItem,
  updateSection,
} from "@/lib/reducers";
import { SELECTED_CHIP_COUNT, sectionId } from "@/lib/types";
import type { Chip, Section } from "@/lib/types";

function sections(count: number): Section[] {
  return Array.from({ length: count }, (_, index) => ({
    ord: index + 1,
    path: `topic/${index + 1}`,
    anchor: "",
    title: `Section ${index + 1}`,
    summary: `Summary ${index + 1}`,
    body_md: `Body ${index + 1}`,
    source_names: [`file-${index + 1}.md`],
  }));
}

function chips(count: number, selected = 0): Chip[] {
  return Array.from({ length: count }, (_, index) => ({
    text: `question ${index + 1}`,
    kb_section: `topic/${index + 1}`,
    register: "narrative" as const,
    selected: index < selected,
    why_it_lands: "",
  }));
}

describe("sections", () => {
  it("renumbers after a move, keeping the order the candidate chose", () => {
    const moved = moveSection(sections(3), 2, 0);

    expect(moved.map((section) => section.title)).toEqual([
      "Section 3",
      "Section 1",
      "Section 2",
    ]);
    expect(moved.map((section) => section.ord)).toEqual([1, 2, 3]);
  });

  it("ignores a move that goes nowhere or off the end", () => {
    const original = sections(3);
    expect(moveSection(original, 1, 1)).toBe(original);
    expect(moveSection(original, 0, 9)).toBe(original);
    expect(moveSection(original, -1, 0)).toBe(original);
  });

  it("renumbers after a delete", () => {
    const remaining = deleteSection(sections(3), 0);

    expect(remaining).toHaveLength(2);
    expect(remaining.map((section) => section.ord)).toEqual([1, 2]);
  });

  it("updates one section without touching its neighbours", () => {
    const updated = updateSection(sections(3), 1, { title: "Renamed" });

    expect(updated[1].title).toBe("Renamed");
    expect(updated[0].title).toBe("Section 1");
    expect(updated[1].body_md).toBe("Body 2");
  });

  it("keeps every word when two sections merge", () => {
    // A candidate who merges the wrong pair should see all the material still
    // there and be able to split it back apart.
    const merged = mergeSectionUp(sections(3), 1);

    expect(merged).toHaveLength(2);
    expect(merged[0].title).toBe("Section 1 — Section 2");
    expect(merged[0].body_md).toBe("Body 1\n\nBody 2");
    expect(merged[0].summary).toBe("Summary 1 Summary 2");
    expect(merged[0].source_names).toEqual(["file-1.md", "file-2.md"]);
    // The survivor keeps the id above it, so anything citing the merged-away
    // section is now orphaned — which the review screen says out loud.
    expect(sectionId(merged[0].path, merged[0].anchor)).toBe("topic/1");
  });

  it("refuses to merge the first section upward", () => {
    const original = sections(3);
    expect(mergeSectionUp(original, 0)).toBe(original);
  });

  it("splits at a paragraph boundary and gives the half a distinct id", () => {
    // Two sections sharing an id would make every reference to it a coin flip,
    // and the server rejects the patch — so the split has to produce a new one.
    const original = updateSection(sections(1), 0, {
      body_md: "One.\n\nTwo.\n\nThree.",
      anchor: "start",
    });

    const split = splitSection(original, 0, 1);

    expect(split).toHaveLength(2);
    expect(split[0].body_md).toBe("One.");
    expect(split[1].body_md).toBe("Two.\n\nThree.");
    expect(split[1].title).toBe("Section 1 (continued)");
    expect(sectionId(split[1].path, split[1].anchor)).not.toBe(
      sectionId(split[0].path, split[0].anchor)
    );
  });

  it("refuses a split that would leave an empty half", () => {
    const original = updateSection(sections(1), 0, { body_md: "One.\n\nTwo." });

    expect(splitSection(original, 0, 0)).toBe(original);
    expect(splitSection(original, 0, 2)).toBe(original);
  });

  it("splitPoints ignores blank paragraphs", () => {
    expect(splitPoints("a\n\n\n\nb\n\n  \n\nc")).toEqual(["a", "b", "c"]);
  });

  it("a new section is numbered and empty rather than half-filled", () => {
    const created = emptySection(4);
    expect(created.ord).toBe(4);
    expect(created.body_md).toBe("");
    expect(created.path).not.toBe("");
  });
});

describe("chips", () => {
  it("toggles one onto the front page", () => {
    const toggled = toggleChip(chips(4), 0);

    expect(toggled[0].selected).toBe(true);
    expect(countSelected(toggled)).toBe(1);
  });

  it("refuses a fourth rather than silently dropping one of the three", () => {
    // The candidate is choosing which three represent them. Having the app pick
    // which one to drop is exactly the wrong moment to be helpful.
    const full = chips(4, SELECTED_CHIP_COUNT);

    const unchanged = toggleChip(full, 3);

    expect(unchanged).toBe(full);
    expect(countSelected(unchanged)).toBe(SELECTED_CHIP_COUNT);
  });

  it("always allows deselecting, even at the limit", () => {
    const full = chips(4, SELECTED_CHIP_COUNT);

    expect(countSelected(toggleChip(full, 0))).toBe(SELECTED_CHIP_COUNT - 1);
  });

  it("updates and deletes by index, ignoring one that is not there", () => {
    const original = chips(3);

    expect(updateChip(original, 1, { text: "new" })[1].text).toBe("new");
    expect(deleteChip(original, 1)).toHaveLength(2);
    expect(updateChip(original, 9, { text: "new" })).toBe(original);
    expect(deleteChip(original, -1)).toBe(original);
  });

  it("a new chip starts unselected and unsourced", () => {
    const created = emptyChip();
    expect(created.selected).toBe(false);
    expect(created.kb_section).toBe("");
  });
});

describe("quiz", () => {
  it("replaces one option without disturbing the answer", () => {
    const quiz = [emptyQuizItem("limits")];

    const updated = updateQuizChoice(quiz, 0, 2, "the third");

    expect(updated[0].choices).toEqual(["", "", "the third", ""]);
    expect(updated[0].correct_index).toBe(0);
  });

  it("ignores an option index that is not there", () => {
    const quiz = [emptyQuizItem("limits")];

    expect(updateQuizChoice(quiz, 0, 9, "nope")).toBe(quiz);
    expect(updateQuizChoice(quiz, 9, 0, "nope")).toBe(quiz);
  });

  it("a new item always has exactly four options", () => {
    // The gate renders four and scores one; three is a broken screen.
    expect(emptyQuizItem("judgement").choices).toHaveLength(4);
  });

  it("updates and deletes by index", () => {
    const quiz = [emptyQuizItem("limits"), emptyQuizItem("substance")];

    expect(updateQuizItem(quiz, 0, { question: "q" })[0].question).toBe("q");
    expect(deleteQuizItem(quiz, 0)).toHaveLength(1);
  });

  it("counts every category, including the empty ones", () => {
    // An empty category is what the gate cannot run on, so it has to be visible
    // rather than absent from the tally.
    const counts = countByCategory([
      emptyQuizItem("limits"),
      emptyQuizItem("limits"),
    ]);

    expect(counts).toEqual({
      motivation: 0,
      judgement: 0,
      limits: 2,
      substance: 0,
    });
  });
});
