import { Composer } from "@/components/chat/Composer";
import { CitationChip } from "@/components/chat/CitationChip";
import { RisoPortrait } from "@/components/course/RisoPortrait";
import { SpecialistTurn, Thread } from "@/components/chat/Thread";
import { SyllabusRail } from "@/components/learn/SyllabusRail";
import { Ticker } from "@/components/frame/Ticker";
import { Button } from "@/components/ui/button";
import { splitPoints } from "@/lib/reducers";
import { toRoman } from "@/lib/text";
import type { Course } from "@/lib/types";

/**
 * /studio/:id/preview — Journey 1, step 4: "[Preview as a student]".
 *
 * This is the real /learn furniture — the rail, the progress meter, the
 * asymmetric thread, the citation chip, the composer — rendered against the
 * draft's own lessons, with the opening diagnostic as the single turn. It is
 * deliberately static: the tutor loop is Journey 3, and a fake conversation
 * would tell the Specialist something untrue about their course.
 *
 * POC_UserJourney.md § Journey 3: the session always opens with a diagnostic,
 * never a lecture.
 */
const OPENING_DIAGNOSTIC =
  "Before I start — what's the thing you're actually trying to do? And what have you already tried that didn't work?";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function LearnPreview({ course }: { course: Course }) {
  const firstLesson = course.lessons[0];
  const initials = initialsOf(course.specialist_name);
  // The citation expands the opening paragraph of lesson I — real material, so
  // the Specialist can see how their own words read inside a chip.
  const citation = splitPoints(firstLesson?.body_md ?? "")[0];

  return (
    <div className="flex flex-col border-[3px] border-ink">
      <Ticker
        phrases={["Preview — not live"]}
        className="border-b-[3px] border-ink"
      />

      <div className="flex min-h-[520px] max-md:flex-col">
        <SyllabusRail
          lessons={course.lessons}
          activeOrd={firstLesson?.ord ?? 1}
          note="As a new student sees it"
          footer={
            <Button variant="secondary" disabled className="w-full">
              Ask {course.specialist_name.split(" ")[0]}
            </Button>
          }
          className="max-md:w-full max-md:border-r-0 max-md:border-b-[3px]"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-8 p-8 max-md:p-5">
          <div className="flex items-center gap-3 border-2 border-ink px-4 py-2.5">
            <RisoPortrait
              name={course.specialist_name}
              initials={initials}
              size="sm"
            />
            <p className="type-meta">
              {course.specialist_name} · Lesson {toRoman(firstLesson?.ord ?? 1)}{" "}
              of {toRoman(course.lessons.length)}
            </p>
          </div>

          <Thread>
            <SpecialistTurn name={course.specialist_name} initials={initials}>
              <p>{OPENING_DIAGNOSTIC}</p>
              {citation && firstLesson && (
                <div className="mt-3">
                  <CitationChip
                    lessonOrd={firstLesson.ord}
                    lessonTitle={firstLesson.title}
                    quote={citation}
                  />
                </div>
              )}
            </SpecialistTurn>
          </Thread>

          <Composer
            disabled
            placeholder={`Answer ${course.specialist_name.split(" ")[0]}…`}
          />
        </div>
      </div>
    </div>
  );
}
