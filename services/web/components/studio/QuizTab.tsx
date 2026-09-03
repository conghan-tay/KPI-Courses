"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/chrome/Notice";
import { Textarea } from "@/components/ui/textarea";
import {
  countByCategory,
  deleteQuizItem,
  emptyQuizItem,
  updateQuizChoice,
  updateQuizItem,
} from "@/lib/reducers";
import { looksCtrlFAnswerable, QUIZ_PER_CATEGORY, TARGET_QUIZ_ITEMS } from "@/lib/refs";
import type { QuizCategory, QuizItem } from "@/lib/types";

/**
 * The last gate before a recruiter books twenty minutes of real time.
 *
 * Grouped by category because the gate samples one item from each, so an empty
 * category is not a thin quiz — it is a gate that cannot be run, and the server
 * refuses to publish one. The warnings here say that before the publish dialog
 * has to.
 */
const CATEGORIES: { value: QuizCategory; label: string; brief: string }[] = [
  {
    value: "motivation",
    label: "Motivation",
    brief: "Why you left, what you want, what you'd turn down.",
  },
  {
    value: "judgement",
    label: "Judgement",
    brief:
      "A situation not in your knowledge base, where your stated principles predict what you'd do. The strongest category: it can't be memorised.",
  },
  {
    value: "limits",
    label: "Limits",
    brief:
      "What you say you aren't good at. Someone who read honestly knows the boundaries; someone who skimmed only knows the highlights.",
  },
  {
    value: "substance",
    label: "Substance",
    brief: "The shape of what you owned: scope, the tradeoff, what you'd change. Never a metric.",
  },
];

export function QuizTab({
  quiz,
  unresolved,
  onChange,
}: {
  quiz: QuizItem[];
  /** Indexes whose `source_section` names nothing — see lib/refs.ts. */
  unresolved: number[];
  onChange: (quiz: QuizItem[]) => void;
}) {
  const counts = countByCategory(quiz);
  const empty = CATEGORIES.filter((category) => counts[category.value] === 0);
  const lookups = quiz
    .map((item, index) => (looksCtrlFAnswerable(item) ? index : -1))
    .filter((index) => index >= 0);

  return (
    <div className="flex flex-col gap-6">
      <p className="type-body-l measure-read">
        {quiz.length} questions. Four are sampled, one per category, and a
        recruiter has to get all four right before they can book you. It should
        be passed by anyone who spent their hour genuinely trying to understand
        you, and failed by someone who skimmed for keywords.
      </p>

      {empty.length > 0 && (
        <Notice tone="danger" label="The gate can't run">
          <p>
            No questions in: {empty.map((category) => category.label).join(", ")}.
            The gate asks one from each category, so it needs at least one in
            every one of them. You can&apos;t publish until this is fixed.
          </p>
        </Notice>
      )}

      {quiz.length < TARGET_QUIZ_ITEMS && quiz.length > 0 && empty.length === 0 && (
        <Notice label={`${quiz.length} of ${TARGET_QUIZ_ITEMS}`}>
          We aim for {TARGET_QUIZ_ITEMS}, which is {QUIZ_PER_CATEGORY} per category, so
          a reload isn&apos;t a free second attempt at the same four questions.
          You can publish with fewer.
        </Notice>
      )}

      {lookups.length > 0 && (
        <Notice label="Answerable by ctrl-F">
          <p>
            {lookups.length} question{lookups.length === 1 ? " has" : "s have"} a
            number for an answer, which tests memory rather than understanding.
            Someone who skimmed for keywords will get{" "}
            {lookups.length === 1 ? "it" : "them"} right. Worth rewriting, but
            they won&apos;t stop you publishing.
          </p>
        </Notice>
      )}

      {CATEGORIES.map((category) => {
        const items = quiz
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.category === category.value);

        return (
          <section key={category.value} className="flex flex-col gap-4">
            <div className="border-b border-hairline pb-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="type-headline">{category.label}</h3>
                <span
                  className={`type-caption border border-hairline px-2 py-0.5 ${
                    items.length >= QUIZ_PER_CATEGORY ? "bg-surface-sunk text-ink" : "bg-surface text-ink-subtle"
                  }`}
                >
                  {items.length} / {QUIZ_PER_CATEGORY}
                </span>
              </div>
              <p className="type-body-sm measure-read mt-1 text-ink-muted">
                {category.brief}
              </p>
            </div>

            {items.map(({ item, index }) => (
              <QuizCard
                key={index}
                item={item}
                index={index}
                unresolved={unresolved.includes(index)}
                onChange={(patch) => onChange(updateQuizItem(quiz, index, patch))}
                onChoiceChange={(choiceIndex, text) =>
                  onChange(updateQuizChoice(quiz, index, choiceIndex, text))
                }
                onDelete={() => onChange(deleteQuizItem(quiz, index))}
              />
            ))}

            <button
              type="button"
              onClick={() => onChange([...quiz, emptyQuizItem(category.value)])}
              className="type-label flex items-center justify-center gap-2 rounded-lg border border-dashed border-hairline bg-surface p-5 text-ink-muted transition-colors duration-120 ease-out hover:border-ink-subtle hover:text-ink"
            >
              <Plus className="size-4" aria-hidden />
              Add a {category.label.toLowerCase()} question
            </button>
          </section>
        );
      })}
    </div>
  );
}

function QuizCard({
  item,
  index,
  unresolved,
  onChange,
  onChoiceChange,
  onDelete,
}: {
  item: QuizItem;
  index: number;
  unresolved: boolean;
  onChange: (patch: Partial<QuizItem>) => void;
  onChoiceChange: (choiceIndex: number, text: string) => void;
  onDelete: () => void;
}) {
  const lookup = looksCtrlFAnswerable(item);
  const label = item.id || `Question ${index + 1}`;

  return (
    <article className="flex flex-col gap-4 border border-hairline bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-caption font-mono text-ink-muted">{label}</p>
        {lookup && (
          <p className="type-caption border border-hairline px-2 py-0.5">
            Answerable by ctrl-F
          </p>
        )}
      </div>

      <Textarea
        aria-label={`Question text for ${label}`}
        value={item.question}
        onChange={(event) => onChange({ question: event.target.value })}
        rows={2}
        className="type-title"
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="type-caption text-ink-muted">
          Four options: the right one, and three a competent generic engineer
          would give
        </legend>
        {item.choices.map((choice, choiceIndex) => (
          <label key={choiceIndex} className="flex items-center gap-3">
            <input
              type="radio"
              name={`correct-${index}`}
              checked={item.correct_index === choiceIndex}
              onChange={() => onChange({ correct_index: choiceIndex })}
              aria-label={`Mark option ${choiceIndex + 1} correct`}
              className="size-5 shrink-0 accent-black"
            />
            <Input
              aria-label={`Option ${choiceIndex + 1} for ${label}`}
              value={choice}
              onChange={(event) => onChoiceChange(choiceIndex, event.target.value)}
              className={
                item.correct_index === choiceIndex
                  ? "bg-surface-sunk font-medium"
                  : undefined
              }
            />
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <p className="type-caption text-ink-muted">
          Why it&apos;s right. For you, never shown to a recruiter.
        </p>
        <Textarea
          aria-label={`Rationale for ${label}`}
          value={item.rationale}
          onChange={(event) => onChange({ rationale: event.target.value })}
          rows={2}
          className="type-body-sm"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="type-caption text-ink-muted">Answers from</p>
        <Input
          aria-label={`Source section for ${label}`}
          value={item.source_section}
          onChange={(event) => onChange({ source_section: event.target.value })}
          placeholder="career/timeline#agoda-exit"
          className="font-mono text-[13px]"
        />
      </div>

      {unresolved && (
        <div className="flex items-stretch border border-hairline">
                    <p className="type-body-sm px-3 py-2 text-ink">
            This points at a section that isn&apos;t in your knowledge base, so
            nobody could have learned the answer from reading it.
          </p>
        </div>
      )}

      <div className="flex justify-end border-t border-hairline-soft pt-3">
        <Button variant="danger" size="sm" onClick={onDelete}>
          <Trash2 className="size-3.5" aria-hidden />
          Delete
        </Button>
      </div>
    </article>
  );
}
