import Link from "next/link";

import { formatPrice } from "@/lib/text";
import type { CourseSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

// DESIGN.md §11 — /studio is a table, not cards. 2px rules, label caps headers,
// paper-tint zebra. Draft rows carry the hatch strip from §2, which is what
// makes "not live yet" readable in greyscale and in a screenshot.

function StatusCell({ course }: { course: CourseSummary }) {
  if (course.ingest_status === "running") {
    return <span className="type-meta">Building…</span>;
  }
  if (course.ingest_status === "failed") {
    return <span className="type-meta text-alert">Ingestion failed</span>;
  }
  return (
    <span className="type-meta">
      {course.status === "published" ? "Published" : "Draft"}
    </span>
  );
}

export function CourseTable({ courses }: { courses: CourseSummary[] }) {
  return (
    <div className="overflow-x-auto border-2 border-ink">
      <table className="w-full border-collapse">
        <caption className="sr-only">Your courses</caption>
        <thead>
          <tr className="bg-paper-tint">
            <th aria-hidden className="w-1.5 border-b-2 border-ink p-0" />
            <th scope="col" className="type-label border-b-2 border-ink px-4 py-3 text-left">
              Course
            </th>
            <th scope="col" className="type-label border-b-2 border-ink px-4 py-3 text-left">
              Lessons
            </th>
            <th scope="col" className="type-label border-b-2 border-ink px-4 py-3 text-left">
              Stances
            </th>
            <th scope="col" className="type-label border-b-2 border-ink px-4 py-3 text-left">
              Price
            </th>
            <th scope="col" className="type-label border-b-2 border-ink px-4 py-3 text-left">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {courses.map((course, index) => (
            <tr
              key={course.id}
              className={cn(index % 2 === 1 && "bg-paper-tint")}
            >
              {/* The draft marker: a hatch gutter rather than a coloured pill. */}
              <td
                aria-hidden
                className={cn(
                  "w-1.5 border-b-2 border-ink p-0",
                  course.status === "draft" && "pat-hatch"
                )}
              />
              <td className="border-b-2 border-ink px-4 py-4">
                <Link
                  href={`/studio/${course.id}`}
                  className="type-title underline-offset-4 hover:underline"
                >
                  {course.title}
                </Link>
                {course.tagline && (
                  <p className="type-body-s measure-ui mt-1 text-ink-muted">
                    {course.tagline}
                  </p>
                )}
              </td>
              <td className="type-meta border-b-2 border-ink px-4 py-4">
                {course.lesson_count}
              </td>
              <td className="type-meta border-b-2 border-ink px-4 py-4">
                {course.position_count}
              </td>
              <td className="border-b-2 border-ink px-4 py-4">
                <span className="type-meta border-2 border-ink bg-pink px-3 py-1">
                  {formatPrice(course.price_cents)}
                </span>
              </td>
              <td className="border-b-2 border-ink px-4 py-4">
                <StatusCell course={course} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
