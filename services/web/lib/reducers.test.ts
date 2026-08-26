import { describe, expect, it } from "vitest";

import {
  deleteLesson,
  deletePosition,
  mergeLessonUp,
  moveLesson,
  renumber,
  splitLesson,
  splitPoints,
  updateLesson,
  updatePosition,
} from "@/lib/reducers";
import type { Lesson, Position } from "@/lib/types";

function lessons(...titles: string[]): Lesson[] {
  return titles.map((title, index) => ({
    ord: index + 1,
    title,
    objective: `Can ${title.toLowerCase()}`,
    key_points: [`${title} point A`, `${title} point B`],
    body_md: `${title} para one.\n\n${title} para two.\n\n${title} para three.`,
  }));
}

const ords = (list: Lesson[]) => list.map((lesson) => lesson.ord);
const titles = (list: Lesson[]) => list.map((lesson) => lesson.title);

describe("moveLesson", () => {
  it("moves a lesson down and renumbers", () => {
    const result = moveLesson(lessons("A", "B", "C"), 0, 2);
    expect(titles(result)).toEqual(["B", "C", "A"]);
    expect(ords(result)).toEqual([1, 2, 3]);
  });

  it("moves a lesson up", () => {
    expect(titles(moveLesson(lessons("A", "B", "C"), 2, 0))).toEqual([
      "C",
      "A",
      "B",
    ]);
  });

  it("is a no-op for out-of-range or identical indexes", () => {
    const list = lessons("A", "B");
    expect(moveLesson(list, 1, 1)).toBe(list);
    expect(moveLesson(list, -1, 0)).toBe(list);
    expect(moveLesson(list, 0, 5)).toBe(list);
  });
});

describe("deleteLesson", () => {
  it("removes and closes the gap in ordinals", () => {
    const result = deleteLesson(lessons("A", "B", "C"), 1);
    expect(titles(result)).toEqual(["A", "C"]);
    expect(ords(result)).toEqual([1, 2]);
  });

  it("ignores an index that isn't there", () => {
    const list = lessons("A");
    expect(deleteLesson(list, 4)).toBe(list);
  });
});

describe("mergeLessonUp", () => {
  it("folds a lesson into the one above it, keeping every key point", () => {
    const result = mergeLessonUp(lessons("A", "B", "C"), 1);

    expect(titles(result)).toEqual(["A — B", "C"]);
    expect(ords(result)).toEqual([1, 2]);
    expect(result[0].key_points).toEqual([
      "A point A",
      "A point B",
      "B point A",
      "B point B",
    ]);
    // Nothing is thrown away: both bodies survive, separated by a blank line.
    expect(result[0].body_md).toContain("A para three.");
    expect(result[0].body_md).toContain("B para one.");
  });

  it("cannot merge the first lesson upward", () => {
    const list = lessons("A", "B");
    expect(mergeLessonUp(list, 0)).toBe(list);
  });
});

describe("splitLesson", () => {
  it("splits at a paragraph boundary and renumbers", () => {
    const result = splitLesson(lessons("A", "B"), 0, 1);

    expect(ords(result)).toEqual([1, 2, 3]);
    expect(result[0].body_md).toBe("A para one.");
    expect(result[1].body_md).toBe("A para two.\n\nA para three.");
    expect(result[1].title).toBe("A (continued)");
  });

  it("divides key points between the halves", () => {
    const result = splitLesson(lessons("A"), 0, 1);
    expect(result[0].key_points).toEqual(["A point A"]);
    expect(result[1].key_points).toEqual(["A point B"]);
  });

  it("refuses a split that would leave an empty lesson", () => {
    const list = lessons("A");
    expect(splitLesson(list, 0, 0)).toBe(list);
    expect(splitLesson(list, 0, 3)).toBe(list);
  });

  it("counts paragraphs, ignoring blank runs", () => {
    expect(splitPoints("one\n\n\n\ntwo\n\n  \n\nthree")).toEqual([
      "one",
      "two",
      "three",
    ]);
  });
});

describe("updateLesson", () => {
  it("patches one lesson and leaves the rest alone", () => {
    const list = lessons("A", "B");
    const result = updateLesson(list, 1, { title: "Renamed" });
    expect(titles(result)).toEqual(["A", "Renamed"]);
    expect(result[0]).toBe(list[0]);
  });
});

describe("renumber", () => {
  it("always produces 1..n with no gaps", () => {
    const scrambled: Lesson[] = lessons("A", "B", "C").map((lesson) => ({
      ...lesson,
      ord: 99,
    }));
    expect(ords(renumber(scrambled))).toEqual([1, 2, 3]);
  });
});

describe("positions", () => {
  const positions: Position[] = [
    { claim: "one", because: "b", pushback: "p" },
    { claim: "two", because: "b", pushback: "p" },
  ];

  it("patches a single position", () => {
    const result = updatePosition(positions, 0, { claim: "edited" });
    expect(result[0].claim).toBe("edited");
    expect(result[1]).toBe(positions[1]);
  });

  it("deletes a position", () => {
    expect(deletePosition(positions, 0).map((p) => p.claim)).toEqual(["two"]);
  });

  it("ignores out-of-range indexes", () => {
    expect(updatePosition(positions, 9, { claim: "x" })).toBe(positions);
    expect(deletePosition(positions, -1)).toBe(positions);
  });
});
