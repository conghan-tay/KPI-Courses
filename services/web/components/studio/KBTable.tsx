import Link from "next/link";

import type { KBSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

// DESIGN.md §11 — /studio is a table, not cards. 2px rules, label caps headers,
// paper-tint zebra. Draft rows carry the hatch strip from §2, which is what
// makes "not live yet" readable in greyscale and in a screenshot.

function StatusCell({ row }: { row: KBSummary }) {
  if (row.ingest_status === "running") {
    return <span className="type-meta">Building…</span>;
  }
  if (row.ingest_status === "failed") {
    return <span className="type-meta text-alert">Ingestion failed</span>;
  }
  return (
    <span className="type-meta">
      {row.status === "published" ? "Published" : "Draft"}
    </span>
  );
}

export function KBTable({ rows }: { rows: KBSummary[] }) {
  return (
    <div className="overflow-x-auto border-2 border-ink">
      <table className="w-full border-collapse">
        <caption className="sr-only">Your knowledge bases</caption>
        <thead>
          <tr className="bg-paper-tint">
            <th aria-hidden className="w-1.5 border-b-2 border-ink p-0" />
            <th scope="col" className="type-label border-b-2 border-ink px-4 py-3 text-left">
              Knowledge base
            </th>
            <th scope="col" className="type-label border-b-2 border-ink px-4 py-3 text-left">
              Sections
            </th>
            <th scope="col" className="type-label border-b-2 border-ink px-4 py-3 text-left">
              Questions
            </th>
            <th scope="col" className="type-label border-b-2 border-ink px-4 py-3 text-left">
              Quiz
            </th>
            <th scope="col" className="type-label border-b-2 border-ink px-4 py-3 text-left">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id} className={cn(index % 2 === 1 && "bg-paper-tint")}>
              {/* The draft marker: a hatch gutter rather than a coloured pill. */}
              <td
                aria-hidden
                className={cn(
                  "w-1.5 border-b-2 border-ink p-0",
                  row.status === "draft" && "pat-hatch"
                )}
              />
              <td className="border-b-2 border-ink px-4 py-4">
                <Link
                  href={`/studio/${row.id}`}
                  className="type-title underline-offset-4 hover:underline"
                >
                  {row.title}
                </Link>
                {row.tagline && (
                  <p className="type-body-s measure-ui mt-1 text-ink-muted">
                    {row.tagline}
                  </p>
                )}
              </td>
              <td className="type-meta border-b-2 border-ink px-4 py-4">
                {row.section_count}
              </td>
              <td className="type-meta border-b-2 border-ink px-4 py-4">
                {row.chip_count}
              </td>
              <td className="type-meta border-b-2 border-ink px-4 py-4">
                {row.quiz_count}
              </td>
              <td className="border-b-2 border-ink px-4 py-4">
                <StatusCell row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
