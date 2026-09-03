import { describe, expect, it } from "vitest";

import { readFixture } from "@/lib/fixture";
import {
  auditRefs,
  isRefResolved,
  looksCtrlFAnswerable,
  normalizeRef,
  sectionIdSet,
  TARGET_CHIPS,
} from "@/lib/refs";
import type { Chip, QuizItem, Section } from "@/lib/types";

function section(path: string, anchor = ""): Section {
  return {
    ord: 1,
    path,
    anchor,
    title: "A section",
    summary: "",
    body_md: "",
    source_names: [],
  };
}

function chip(kb_section: string): Chip {
  return {
    text: "a question",
    kb_section,
    register: "narrative",
    selected: false,
    why_it_lands: "",
  };
}

function quizItem(source_section: string, choices?: string[]): QuizItem {
  return {
    id: "q01",
    category: "substance",
    question: "a question",
    choices: choices ?? ["a", "b", "c", "d"],
    correct_index: 0,
    rationale: "",
    source_section,
  };
}

describe("the reference fixture", () => {
  // Assertion B2, run against the real bytes rather than a stub — the same
  // check services/agent/tests/test_refs.py makes on the Python side.
  it("resolves every chip and quiz reference", async () => {
    const fixture = await readFixture();

    const report = auditRefs(
      fixture.sections.map((raw, index) => ({ ...raw, ord: raw.ord ?? index + 1 })),
      fixture.chips,
      fixture.quiz
    );

    expect(report.chips).toEqual([]);
    expect(report.quiz).toEqual([]);
    expect(report.resolved).toBe(report.total);
    expect(fixture.chips).toHaveLength(TARGET_CHIPS);
  });

  it("has no question answerable by ctrl-F", async () => {
    const fixture = await readFixture();

    const lookups = fixture.quiz.filter(looksCtrlFAnswerable).map((q) => q.id);

    expect(lookups).toEqual([]);
  });
});

describe("resolution", () => {
  const known = sectionIdSet([
    section("agoda/psp-routing", "circuit-breakers"),
    section("postgres/opinions"),
  ]);

  it("a similar id is not a match", () => {
    expect(isRefResolved("agoda/psp-routing", known)).toBe(false);
    expect(isRefResolved("agoda/psp-routing#breakers", known)).toBe(false);
  });

  it("an empty reference is not resolved", () => {
    // "No source" and "a source that does not exist" are the same thing from a
    // reader's point of view, and both deserve the same warning.
    expect(isRefResolved("", known)).toBe(false);
    expect(isRefResolved("   ", known)).toBe(false);
    expect(isRefResolved(undefined, known)).toBe(false);
  });

  it("case and stray separators do not count as invention", () => {
    expect(isRefResolved("Agoda/PSP-Routing#Circuit-Breakers", known)).toBe(true);
    expect(isRefResolved("  #postgres/opinions  ", known)).toBe(true);
  });

  it("normalisation is idempotent", () => {
    // Both sides of the wire normalise; normalising twice must not drift.
    const once = normalizeRef("  #Agoda/PSP-Routing#Circuit-Breakers/ ");
    expect(normalizeRef(once)).toBe(once);
  });
});

describe("auditRefs", () => {
  it("reports which chips and questions point at nothing", () => {
    const sections = [section("a/one"), section("b/two")];

    const report = auditRefs(
      sections,
      [chip("a/one"), chip("c/three"), chip("")],
      [quizItem("b/two"), quizItem("nowhere")]
    );

    expect(report.chips).toEqual([1, 2]);
    expect(report.quiz).toEqual([1]);
    expect(report.resolved).toBe(2);
    expect(report.total).toBe(5);
  });

  it("finds the case the pipeline cannot prevent: a deleted section", () => {
    // The pipeline clears a reference it cannot resolve, so a fresh knowledge
    // base has none. The candidate deleting a section out from under three
    // questions is what this check exists for.
    const chips = [chip("a/one"), chip("a/one"), chip("a/one")];

    expect(auditRefs([section("a/one")], chips, []).chips).toEqual([]);
    expect(auditRefs([], chips, []).chips).toEqual([0, 1, 2]);
  });
});

describe("looksCtrlFAnswerable", () => {
  it("flags an answer that is a bare quantity", () => {
    expect(looksCtrlFAnswerable(quizItem("a", ["Four", "b", "c", "d"]))).toBe(true);
    expect(looksCtrlFAnswerable(quizItem("a", ["About 94%", "b", "c", "d"]))).toBe(
      true
    );
    expect(looksCtrlFAnswerable(quizItem("a", ["210ms", "b", "c", "d"]))).toBe(true);
  });

  it("does not flag an answer that merely mentions a number", () => {
    // The rule is "the answer IS a number", not "the answer mentions one" —
    // otherwise every question about a system with a threshold gets flagged.
    expect(
      looksCtrlFAnswerable(
        quizItem("a", [
          "Five consecutive failures, because that is the fast path for a dead provider",
          "b",
          "c",
          "d",
        ])
      )
    ).toBe(false);
  });
});
