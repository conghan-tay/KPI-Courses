import {
  SELECTED_CHIP_COUNT,
  type Chip,
  type QuizCategory,
  type QuizItem,
  type Section,
} from "@/lib/types";

// Every edit the review screen can make is a pure function from a list to a
// list. The screen holds state, the route handler persists it, and neither of
// them contains the rules — which is what makes the rules testable.

// ── Sections ──────────────────────────────────────────────────────────────

/** `ord` is a display ordinal, so it is always 1..n with no gaps. */
export function renumber(sections: Section[]): Section[] {
  return sections.map((section, index) => ({ ...section, ord: index + 1 }));
}

export function moveSection(
  sections: Section[],
  from: number,
  to: number
): Section[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= sections.length ||
    to >= sections.length
  ) {
    return sections;
  }
  const next = [...sections];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return renumber(next);
}

export function deleteSection(sections: Section[], index: number): Section[] {
  if (index < 0 || index >= sections.length) return sections;
  return renumber(sections.filter((_, i) => i !== index));
}

export function updateSection(
  sections: Section[],
  index: number,
  patch: Partial<Section>
): Section[] {
  if (index < 0 || index >= sections.length) return sections;
  return sections.map((section, i) =>
    i === index ? { ...section, ...patch } : section
  );
}

/**
 * Merge a section into the one above it. Titles join with an em dash, summaries
 * and bodies concatenate. Nothing is thrown away: a candidate who merges the
 * wrong pair should see all the material still there and be able to split it
 * back apart.
 *
 * The surviving section keeps the one above's id, which is the important part —
 * every chip and quiz item that cited the merged-away section now points at
 * nothing, and the review screen says so rather than guessing.
 */
export function mergeSectionUp(sections: Section[], index: number): Section[] {
  if (index <= 0 || index >= sections.length) return sections;
  const above = sections[index - 1];
  const current = sections[index];

  const merged: Section = {
    ...above,
    title: `${above.title} — ${current.title}`,
    summary: [above.summary, current.summary].filter(Boolean).join(" "),
    body_md: [above.body_md, current.body_md].filter(Boolean).join("\n\n"),
    source_names: [
      ...new Set([...above.source_names, ...current.source_names]),
    ],
  };

  const next = [...sections];
  next.splice(index - 1, 2, merged);
  return renumber(next);
}

/** The paragraph boundaries a section body can be split at. */
export function splitPoints(bodyMd: string): string[] {
  return bodyMd
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/**
 * Split one section into two at a paragraph boundary. `at` is the index of the
 * first paragraph that belongs to the *second* section, so 0 and length are
 * no-ops rather than producing an empty one.
 *
 * The new section gets a distinct anchor: two sections sharing an id would turn
 * every reference to it into a coin flip, and the server rejects the patch.
 */
export function splitSection(
  sections: Section[],
  index: number,
  at: number
): Section[] {
  if (index < 0 || index >= sections.length) return sections;
  const section = sections[index];
  const paragraphs = splitPoints(section.body_md);
  if (at <= 0 || at >= paragraphs.length) return sections;

  const first: Section = {
    ...section,
    body_md: paragraphs.slice(0, at).join("\n\n"),
  };
  const second: Section = {
    ...section,
    anchor: uniqueAnchor(sections, section),
    title: `${section.title} (continued)`,
    body_md: paragraphs.slice(at).join("\n\n"),
  };

  const next = [...sections];
  next.splice(index, 1, first, second);
  return renumber(next);
}

/** An anchor under the same path that no existing section is using. */
function uniqueAnchor(sections: Section[], section: Section): string {
  const taken = new Set(
    sections
      .filter((other) => other.path === section.path)
      .map((other) => other.anchor)
  );
  const base = section.anchor || "part";
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function emptySection(ord: number): Section {
  return {
    ord,
    path: `section-${ord}`,
    anchor: "",
    title: "New section",
    summary: "",
    body_md: "",
    source_names: [],
  };
}

// ── Chips ─────────────────────────────────────────────────────────────────

export function updateChip(
  chips: Chip[],
  index: number,
  patch: Partial<Chip>
): Chip[] {
  if (index < 0 || index >= chips.length) return chips;
  return chips.map((chip, i) => (i === index ? { ...chip, ...patch } : chip));
}

export function deleteChip(chips: Chip[], index: number): Chip[] {
  if (index < 0 || index >= chips.length) return chips;
  return chips.filter((_, i) => i !== index);
}

/**
 * Toggle a chip onto or off the front page.
 *
 * Selecting a fourth is refused rather than silently deselecting one of the
 * three: the candidate is choosing which three questions represent them, and
 * having the app pick which one to drop is exactly the wrong moment to be
 * helpful. Publishing needs precisely three, so the counter on the tab is what
 * tells them where they stand.
 */
export function toggleChip(chips: Chip[], index: number): Chip[] {
  if (index < 0 || index >= chips.length) return chips;
  const selecting = !chips[index].selected;
  if (selecting && countSelected(chips) >= SELECTED_CHIP_COUNT) return chips;
  return updateChip(chips, index, { selected: selecting });
}

export function countSelected(chips: Chip[]): number {
  return chips.filter((chip) => chip.selected).length;
}

export function emptyChip(): Chip {
  return {
    text: "",
    kb_section: "",
    register: "narrative",
    selected: false,
    why_it_lands: "",
  };
}

// ── Quiz ──────────────────────────────────────────────────────────────────

export function updateQuizItem(
  quiz: QuizItem[],
  index: number,
  patch: Partial<QuizItem>
): QuizItem[] {
  if (index < 0 || index >= quiz.length) return quiz;
  return quiz.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

/** Replace one option in place, leaving the other three and the answer alone. */
export function updateQuizChoice(
  quiz: QuizItem[],
  index: number,
  choiceIndex: number,
  text: string
): QuizItem[] {
  if (index < 0 || index >= quiz.length) return quiz;
  const item = quiz[index];
  if (choiceIndex < 0 || choiceIndex >= item.choices.length) return quiz;
  const choices = item.choices.map((choice, i) =>
    i === choiceIndex ? text : choice
  );
  return updateQuizItem(quiz, index, { choices });
}

export function deleteQuizItem(quiz: QuizItem[], index: number): QuizItem[] {
  if (index < 0 || index >= quiz.length) return quiz;
  return quiz.filter((_, i) => i !== index);
}

export function emptyQuizItem(category: QuizCategory): QuizItem {
  return {
    id: "",
    category,
    question: "",
    // Four, always: the gate renders four options and scores one, so an item
    // with three is a broken screen rather than a weak question.
    choices: ["", "", "", ""],
    correct_index: 0,
    rationale: "",
    source_section: "",
  };
}

/** How many items each category holds, for the tab's balance warning. */
export function countByCategory(quiz: QuizItem[]): Record<QuizCategory, number> {
  const counts: Record<QuizCategory, number> = {
    motivation: 0,
    judgement: 0,
    limits: 0,
    substance: 0,
  };
  for (const item of quiz) counts[item.category] += 1;
  return counts;
}
