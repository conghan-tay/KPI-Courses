"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { patchCourse } from "@/lib/api-client";
import type { Course, CoursePatch } from "@/lib/types";

export type SaveState = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 600;

/**
 * Edits on the review screen are optimistic and debounced: typing into a claim
 * shouldn't wait on a round trip, and it shouldn't fire one per keystroke
 * either. Pending fields accumulate so a fast edit across two tabs still saves
 * as one PATCH.
 *
 * `flush` exists because navigation is the one moment a debounce is dangerous —
 * publishing or opening the preview flushes first.
 */
export function useCourseDraft(initial: Course) {
  const [course, setCourse] = useState(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const pending = useRef<CoursePatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const courseId = initial.id;

  const send = useCallback(async () => {
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;

    setSaveState("saving");
    try {
      const saved = await patchCourse(courseId, patch);
      // Only adopt server-owned fields; the rest of the local draft may have
      // moved on while the request was in flight.
      setCourse((current) => ({
        ...current,
        slug: saved.slug,
        updated_at: saved.updated_at,
        lessons: patch.lessons ? saved.lessons : current.lessons,
      }));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [courseId]);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await send();
  }, [send]);

  const apply = useCallback(
    (patch: CoursePatch) => {
      setCourse((current) => ({ ...current, ...patch }));
      pending.current = { ...pending.current, ...patch };

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void send();
      }, DEBOUNCE_MS);
    },
    [send]
  );

  /** For edits that must land now — deletes, publishes, a model rewrite. */
  const replace = useCallback((next: Course) => {
    setCourse(next);
    setSaveState("saved");
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { course, saveState, apply, flush, replace };
}
