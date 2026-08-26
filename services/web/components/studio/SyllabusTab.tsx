"use client";

import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/form/Field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteLesson,
  emptyLesson,
  mergeLessonUp,
  moveLesson,
  splitLesson,
  splitPoints,
  updateLesson,
} from "@/lib/reducers";
import { toRoman } from "@/lib/text";
import { cn } from "@/lib/utils";
import type { Lesson } from "@/lib/types";

// POC_UserJourney.md § "The review screen" — drag-reorderable lesson list,
// inline-edit title + objective, collapsible body, Merge / Split / Delete.
//
// Drag is not the only way to reorder. Every row also carries move up/down
// buttons: dragging is unusable with a keyboard, and DESIGN.md §8 requires a
// non-hover, non-drag equivalent for every affordance on tablet.

function LessonRow({
  lesson,
  index,
  total,
  onPatch,
  onMove,
  onMerge,
  onSplit,
  onDelete,
}: {
  lesson: Lesson;
  index: number;
  total: number;
  onPatch: (patch: Partial<Lesson>) => void;
  onMove: (to: number) => void;
  onMerge: () => void;
  onSplit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(lesson.ord) });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "border-2 border-ink bg-paper p-5",
        isDragging && "relative z-10 shadow-lift"
      )}
    >
      <div className="flex items-start gap-4">
        <button
          type="button"
          aria-label={`Reorder ${lesson.title}`}
          className="mt-1 cursor-grab p-1 text-ink"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-5" aria-hidden />
        </button>

        <span className="type-meta mt-2 grid size-7 shrink-0 place-items-center rounded-full border-2 border-ink bg-pink text-[10px]">
          {toRoman(lesson.ord)}
        </span>

        <div className="flex flex-1 flex-col gap-3">
          <Input
            aria-label={`Title of lesson ${lesson.ord}`}
            value={lesson.title}
            onChange={(event) => onPatch({ title: event.target.value })}
            className="type-title"
          />

          <Field
            label="Objective"
            hint="A capability, not a topic. Start it with “Can …”."
          >
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                value={lesson.objective}
                onChange={(event) => onPatch({ objective: event.target.value })}
              />
            )}
          </Field>

          {open && (
            <Field label="Lesson body (markdown)">
              {(props) => (
                <Textarea
                  {...props}
                  rows={12}
                  value={lesson.body_md}
                  onChange={(event) => onPatch({ body_md: event.target.value })}
                  className="type-body-l"
                />
              )}
            </Field>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Move ${lesson.title} up`}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Move ${lesson.title} down`}
            disabled={index === total - 1}
            onClick={() => onMove(index + 1)}
          >
            <ChevronDown />
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t-2 border-ink pt-4">
        <Button variant="secondary" size="sm" onClick={() => setOpen(!open)}>
          {open ? "Hide body" : `Body · ${splitPoints(lesson.body_md).length} ¶`}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={index === 0}
          onClick={onMerge}
        >
          Merge up
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={splitPoints(lesson.body_md).length < 2}
          onClick={onSplit}
        >
          Split
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="ml-auto"
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}

export function SyllabusTab({
  lessons,
  onChange,
}: {
  lessons: Lesson[];
  onChange: (lessons: Lesson[]) => void;
}) {
  const [splitting, setSplitting] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = lessons.findIndex((l) => String(l.ord) === active.id);
    const to = lessons.findIndex((l) => String(l.ord) === over.id);
    onChange(moveLesson(lessons, from, to));
  }

  const paragraphs =
    splitting === null ? [] : splitPoints(lessons[splitting]?.body_md ?? "");

  return (
    <div className="flex flex-col gap-6">
      <p className="type-body-l measure-read">
        Reorder, retitle, merge or split. The objective is what the tutor tests
        against, so make it something the student can do, not something they
        have heard of.
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={lessons.map((lesson) => String(lesson.ord))}
          strategy={verticalListSortingStrategy}
        >
          <ol className="flex flex-col gap-4">
            {lessons.map((lesson, index) => (
              <LessonRow
                key={lesson.ord}
                lesson={lesson}
                index={index}
                total={lessons.length}
                onPatch={(patch) => onChange(updateLesson(lessons, index, patch))}
                onMove={(to) => onChange(moveLesson(lessons, index, to))}
                onMerge={() => onChange(mergeLessonUp(lessons, index))}
                onSplit={() => setSplitting(index)}
                onDelete={() => onChange(deleteLesson(lessons, index))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <Button
        variant="secondary"
        className="self-start"
        onClick={() => onChange([...lessons, emptyLesson(lessons.length + 1)])}
      >
        Add a lesson
      </Button>

      <Dialog
        open={splitting !== null}
        onOpenChange={(open) => !open && setSplitting(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Split this lesson</DialogTitle>
            <DialogDescription>
              Pick where the second lesson starts. Everything below the line
              moves into it.
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
                        onChange(splitLesson(lessons, splitting, index));
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
