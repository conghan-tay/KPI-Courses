"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Notice } from "@/components/riso/Notice";
import { PositionCard } from "@/components/course/PositionCard";
import { ApiRequestError, softenPosition } from "@/lib/api-client";
import { deletePosition, emptyPosition, updatePosition } from "@/lib/reducers";
import { THIN_POSITIONS_THRESHOLD } from "@/lib/quotes";
import type { Course, Position } from "@/lib/types";

/**
 * POC_UserJourney.md § "The review screen" — Positions is the default tab, and
 * that is a deliberate reframe: it tells the Specialist "your opinions are the
 * asset", and it is the screen they will actually want to edit.
 */
export function PositionsTab({
  course,
  unanchoredClaims,
  onChange,
  onReplaceCourse,
}: {
  course: Course;
  unanchoredClaims: string[];
  onChange: (positions: Position[]) => void;
  onReplaceCourse: (course: Course) => void;
}) {
  const [softening, setSoftening] = useState<number | null>(null);
  const [softenNote, setSoftenNote] = useState<string | null>(null);

  const thin = course.positions.length < THIN_POSITIONS_THRESHOLD;

  async function soften(index: number) {
    setSoftening(index);
    setSoftenNote(null);
    try {
      onReplaceCourse(await softenPosition(course.id, index));
    } catch (error) {
      // Mock mode has no model. Say so plainly instead of failing silently.
      setSoftenNote(
        error instanceof ApiRequestError
          ? error.detail.message
          : "The rewrite failed."
      );
    } finally {
      setSoftening(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {course.positions.length === 0 ? (
        <Notice label="Nothing contested found">
          <p>
            We didn&apos;t find a claim in your material that a smart peer would
            argue with. That&apos;s common, and it isn&apos;t a problem — your
            course sells on the syllabus instead. Add a stance here if you have
            one.
          </p>
        </Notice>
      ) : (
        <p className="type-body-l measure-read">
          We found {course.positions.length} things you believe that most people
          don&apos;t. Your students are paying for these.
        </p>
      )}

      {thin && course.positions.length > 0 && (
        <Notice label={`Only ${course.positions.length} stances`}>
          Fewer than {THIN_POSITIONS_THRESHOLD} makes for a thin course page.
          You can still publish — the syllabus carries it — but another stance
          or two is the cheapest thing you can do for conversion.
        </Notice>
      )}

      {softenNote && <Notice label="Soften">{softenNote}</Notice>}

      <div className="grid gap-6 lg:grid-cols-2">
        {course.positions.map((position, index) => (
          <PositionCard
            key={index}
            position={position}
            index={index}
            unanchored={unanchoredClaims.includes(position.claim)}
            softenState={softening === index ? "working" : "idle"}
            onChange={(patch) =>
              onChange(updatePosition(course.positions, index, patch))
            }
            onDelete={() => onChange(deletePosition(course.positions, index))}
            onSoften={() => void soften(index)}
          />
        ))}

        <button
          type="button"
          onClick={() => onChange([...course.positions, emptyPosition()])}
          className="type-label flex min-h-40 items-center justify-center gap-2 border-[3px] border-dashed border-ink bg-paper p-6 text-ink hover:bg-pink"
        >
          <Plus className="size-4" aria-hidden />
          Add a stance
        </button>
      </div>
    </div>
  );
}
