"use client";

import { useEffect, useState } from "react";

import { LockedPositionCard } from "@/components/course/PositionCard";
import { RisoPortrait } from "@/components/course/RisoPortrait";
import { getPublicCourse } from "@/lib/api-client";
import { formatPrice } from "@/lib/text";
import type { PublicCourse } from "@/lib/types";

/**
 * DESIGN.md §5.3 gives /studio/:id an 8/4 editor / live-preview split. This is
 * the 4: what a stranger sees on the course page.
 *
 * It deliberately re-fetches through `?audience=public` rather than rendering
 * the course already in memory. The panel therefore proves the withholding rule
 * instead of imitating it — there is no `because` in this component's props to
 * leak, because the server never sent one.
 */
export function PublicPreviewPanel({
  courseId,
  /** Changes when a save lands, which is when the panel should re-read. */
  refreshKey,
}: {
  courseId: string;
  refreshKey: string;
}) {
  const [course, setCourse] = useState<PublicCourse | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPublicCourse(courseId)
      .then((next) => !cancelled && setCourse(next))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [courseId, refreshKey]);

  return (
    <aside className="flex flex-col gap-4">
      <div className="border-b-[3px] border-ink pb-2">
        <p className="type-label">What a stranger sees</p>
        <p className="type-body-s mt-1 text-ink-muted">
          Your argument is never sent to the browser until they buy.
        </p>
      </div>

      {course === null ? (
        <div
          className="pat-halftone h-64 border-2 border-ink"
          aria-label="Loading preview"
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 border-2 border-ink p-4">
            <RisoPortrait
              name={course.specialist_name}
              initials={initialsOf(course.specialist_name)}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="type-label truncate">{course.specialist_name}</p>
              <p className="type-title mt-1">{course.title}</p>
              <p className="type-body-s mt-1 text-ink-muted">
                {course.tagline}
              </p>
              <span className="type-meta mt-3 inline-block border-2 border-ink bg-pink px-3 py-1">
                {formatPrice(course.price_cents)}
              </span>
            </div>
          </div>

          {course.positions.slice(0, 3).map((position, index) => (
            <LockedPositionCard key={index} claim={position.claim} />
          ))}

          {course.positions.length === 0 && (
            <p className="type-body-s text-ink-muted">
              No stances yet, so the course page will lead with the syllabus.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
