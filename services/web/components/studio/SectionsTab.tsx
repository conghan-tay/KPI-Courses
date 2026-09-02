"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Merge, Plus, Scissors, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/riso/Notice";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteSection,
  emptySection,
  mergeSectionUp,
  moveSection,
  splitPoints,
  splitSection,
  updateSection,
} from "@/lib/reducers";
import { toRoman } from "@/lib/text";
import { sectionId } from "@/lib/types";
import type { Section } from "@/lib/types";

/**
 * The knowledge base itself: what the candidate publishes and what the agent
 * will answer from for an hour.
 *
 * The id — `path#anchor` — is editable and shown in mono, because it is not
 * decoration. Every chip and quiz item resolves against it, so renaming a
 * section is how a candidate accidentally orphans three questions. Editing it in
 * plain sight, next to the warnings that appear when it happens, is better than
 * hiding it and letting them wonder.
 */
export function SectionsTab({
  sections,
  citedIds,
  onChange,
}: {
  sections: Section[];
  /** Ids something references, so an orphaning rename is visible as it happens. */
  citedIds: Set<string>;
  onChange: (sections: Section[]) => void;
}) {
  const [open, setOpen] = useState<number | null>(0);
  const [splitting, setSplitting] = useState<number | null>(null);

  const paragraphs =
    splitting === null ? [] : splitPoints(sections[splitting]?.body_md ?? "");

  const orphaned = [...citedIds].filter(
    (id) => !sections.some((section) => sectionId(section.path, section.anchor) === id)
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="type-body-l measure-read">
        {sections.length} sections. This is what the agent answers from — depth
        is the point, because the alternative is a CV bullet.
      </p>

      {orphaned.length > 0 && (
        <Notice label="Questions pointing at nothing">
          <p>
            {orphaned.length} question{orphaned.length === 1 ? "" : "s"} cite a
            section id that no longer exists. Check the Questions and Quiz tabs —
            the agent will have nothing to answer them from.
          </p>
        </Notice>
      )}

      <ol className="flex flex-col gap-4">
        {sections.map((section, index) => {
          const isOpen = open === index;
          const id = sectionId(section.path, section.anchor);
          return (
            <li key={index} className="border-2 border-ink bg-paper">
              <div className="flex items-start gap-4 p-4">
                <span className="type-meta mt-2 grid size-7 shrink-0 place-items-center rounded-full border-2 border-ink font-mono text-[10px]">
                  {toRoman(section.ord)}
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <Input
                    aria-label={`Title of section ${section.ord}`}
                    value={section.title}
                    onChange={(event) =>
                      onChange(
                        updateSection(sections, index, { title: event.target.value })
                      )
                    }
                    className="type-title"
                  />
                  <Textarea
                    aria-label={`Summary of section ${section.ord}`}
                    value={section.summary}
                    onChange={(event) =>
                      onChange(
                        updateSection(sections, index, {
                          summary: event.target.value,
                        })
                      )
                    }
                    rows={2}
                    placeholder="One or two sentences that stand alone."
                    className="type-body-s"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="type-meta text-ink-muted">Id</span>
                    <Input
                      aria-label={`Path of section ${section.ord}`}
                      value={section.path}
                      onChange={(event) =>
                        onChange(
                          updateSection(sections, index, {
                            path: event.target.value,
                          })
                        )
                      }
                      className="w-56 font-mono text-[13px]"
                    />
                    <span aria-hidden className="font-mono">
                      #
                    </span>
                    <Input
                      aria-label={`Anchor of section ${section.ord}`}
                      value={section.anchor}
                      onChange={(event) =>
                        onChange(
                          updateSection(sections, index, {
                            anchor: event.target.value,
                          })
                        )
                      }
                      className="w-44 font-mono text-[13px]"
                    />
                    {citedIds.has(id) && (
                      <span className="type-meta border-2 border-ink bg-ink px-2 py-0.5 text-paper">
                        Cited
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    aria-label={`Move section ${section.ord} up`}
                    disabled={index === 0}
                    onClick={() => onChange(moveSection(sections, index, index - 1))}
                    className="grid size-8 place-items-center border-2 border-ink hover:bg-pink disabled:border-ink-faint disabled:text-ink-faint"
                  >
                    <ChevronUp className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move section ${section.ord} down`}
                    disabled={index === sections.length - 1}
                    onClick={() => onChange(moveSection(sections, index, index + 1))}
                    className="grid size-8 place-items-center border-2 border-ink hover:bg-pink disabled:border-ink-faint disabled:text-ink-faint"
                  >
                    <ChevronDown className="size-4" aria-hidden />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t-2 border-ink p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(isOpen ? null : index)}
                >
                  {isOpen ? "Hide body" : "Edit body"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={index === 0}
                  onClick={() => onChange(mergeSectionUp(sections, index))}
                >
                  <Merge className="size-3.5" aria-hidden />
                  Merge up
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={splitPoints(section.body_md).length < 2}
                  onClick={() => setSplitting(index)}
                >
                  <Scissors className="size-3.5" aria-hidden />
                  Split
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onChange(deleteSection(sections, index))}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Delete
                </Button>
              </div>

              {isOpen && (
                <Textarea
                  aria-label={`Body of section ${section.ord}`}
                  value={section.body_md}
                  onChange={(event) =>
                    onChange(
                      updateSection(sections, index, {
                        body_md: event.target.value,
                      })
                    )
                  }
                  rows={14}
                  className="type-body-l rounded-none border-0 border-t-2"
                />
              )}
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={() => onChange([...sections, emptySection(sections.length + 1)])}
        className="type-label flex items-center justify-center gap-2 border-[3px] border-dashed border-ink bg-paper p-6 text-ink hover:bg-pink"
      >
        <Plus className="size-4" aria-hidden />
        Add a section
      </button>

      <Dialog
        open={splitting !== null}
        onOpenChange={(isOpen) => !isOpen && setSplitting(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Split this section</DialogTitle>
            <DialogDescription>
              Pick where the second section starts. Everything below the line
              moves into it, under a new anchor.
            </DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[50vh] flex-col overflow-y-auto border-2 border-ink">
            {paragraphs.map((paragraph, index) => (
              <div key={index}>
                {index > 0 && (
                  <button
                    type="button"
                    className="type-label w-full border-y-2 border-dashed border-ink bg-paper py-2 text-ink hover:bg-pink"
                    onClick={() => {
                      if (splitting !== null) {
                        onChange(splitSection(sections, splitting, index));
                      }
                      setSplitting(null);
                    }}
                  >
                    Split here
                  </button>
                )}
                <p className="type-body-l px-4 py-3">{paragraph}</p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
