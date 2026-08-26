import type { Lesson, Position } from "@/lib/types";

// Every edit the review screen can make is a pure function from a list to a
// list. The screen holds state, the route handler persists it, and neither of
// them contains the rules — which is what makes the rules testable.

/** `ord` is a display ordinal, so it is always 1..n with no gaps. */
export function renumber(lessons: Lesson[]): Lesson[] {
  return lessons.map((lesson, index) => ({ ...lesson, ord: index + 1 }));
}

export function moveLesson(
  lessons: Lesson[],
  from: number,
  to: number
): Lesson[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= lessons.length ||
    to >= lessons.length
  ) {
    return lessons;
  }
  const next = [...lessons];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return renumber(next);
}

export function deleteLesson(lessons: Lesson[], index: number): Lesson[] {
  if (index < 0 || index >= lessons.length) return lessons;
  return renumber(lessons.filter((_, i) => i !== index));
}

export function updateLesson(
  lessons: Lesson[],
  index: number,
  patch: Partial<Lesson>
): Lesson[] {
  if (index < 0 || index >= lessons.length) return lessons;
  return lessons.map((lesson, i) =>
    i === index ? { ...lesson, ...patch } : lesson
  );
}

/**
 * Merge a lesson into the one above it. Titles join with an em dash, key points
 * concatenate, bodies are separated by a blank line. Nothing is thrown away:
 * a Specialist who merges the wrong pair should be able to see all the material
 * still there and split it back apart.
 */
export function mergeLessonUp(lessons: Lesson[], index: number): Lesson[] {
  if (index <= 0 || index >= lessons.length) return lessons;
  const above = lessons[index - 1];
  const current = lessons[index];

  const merged: Lesson = {
    ...above,
    title: `${above.title} — ${current.title}`,
    objective: above.objective || current.objective,
    key_points: [...above.key_points, ...current.key_points],
    body_md: [above.body_md, current.body_md].filter(Boolean).join("\n\n"),
  };

  const next = [...lessons];
  next.splice(index - 1, 2, merged);
  return renumber(next);
}

/** The paragraph boundaries a lesson body can be split at. */
export function splitPoints(bodyMd: string): string[] {
  return bodyMd
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/**
 * Split one lesson into two at a paragraph boundary. `at` is the index of the
 * first paragraph that belongs to the *second* lesson, so 0 and length are
 * no-ops rather than producing an empty lesson.
 */
export function splitLesson(
  lessons: Lesson[],
  index: number,
  at: number
): Lesson[] {
  if (index < 0 || index >= lessons.length) return lessons;
  const lesson = lessons[index];
  const paragraphs = splitPoints(lesson.body_md);
  if (at <= 0 || at >= paragraphs.length) return lessons;

  const half = Math.ceil(lesson.key_points.length / 2);
  const first: Lesson = {
    ...lesson,
    body_md: paragraphs.slice(0, at).join("\n\n"),
    key_points: lesson.key_points.slice(0, half),
  };
  const second: Lesson = {
    ...lesson,
    title: `${lesson.title} (continued)`,
    body_md: paragraphs.slice(at).join("\n\n"),
    key_points: lesson.key_points.slice(half),
  };

  const next = [...lessons];
  next.splice(index, 1, first, second);
  return renumber(next);
}

export function emptyLesson(ord: number): Lesson {
  return { ord, title: "New lesson", objective: "", key_points: [], body_md: "" };
}

// ── Positions ─────────────────────────────────────────────────────────────

export function updatePosition(
  positions: Position[],
  index: number,
  patch: Partial<Position>
): Position[] {
  if (index < 0 || index >= positions.length) return positions;
  return positions.map((position, i) =>
    i === index ? { ...position, ...patch } : position
  );
}

export function deletePosition(
  positions: Position[],
  index: number
): Position[] {
  if (index < 0 || index >= positions.length) return positions;
  return positions.filter((_, i) => i !== index);
}

export function emptyPosition(): Position {
  return { claim: "", because: "", pushback: "" };
}
