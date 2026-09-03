import Link from "next/link";

import type { KBSummary } from "@/lib/types";

// DESIGN.md §11 — /studio is a table, not cards. 2px rules, label caps headers,
// paper-tint zebra. Draft rows carry the hatch strip from §2, which is what
// makes "not live yet" readable in greyscale and in a screenshot.

function StatusCell({ row }: { row: KBSummary }) {
  if (row.ingest_status === "running") {
    return <span className="type-caption">Building…</span>;
  }
  if (row.ingest_status === "failed") {
    return <span className="type-caption text-danger">Ingestion failed</span>;
  }
  return (
    <span className="type-caption">
      {row.status === "published" ? "Published" : "Draft"}
    </span>
  );
}

export function KBTable({ rows }: { rows: KBSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <caption className="sr-only">Your knowledge bases</caption>
        <thead>
          <tr>
                        <th scope="col" className="type-label border-b border-hairline px-4 py-3 text-left text-ink-muted">
              Knowledge base
            </th>
            <th scope="col" className="type-label border-b border-hairline px-4 py-3 text-left text-ink-muted">
              Sections
            </th>
            <th scope="col" className="type-label border-b border-hairline px-4 py-3 text-left text-ink-muted">
              Questions
            </th>
            <th scope="col" className="type-label border-b border-hairline px-4 py-3 text-left text-ink-muted">
              Quiz
            </th>
            <th scope="col" className="type-label border-b border-hairline px-4 py-3 text-left text-ink-muted">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="transition-colors duration-120 ease-out hover:bg-surface">
              <td className="border-b border-hairline-soft px-4 py-4">
                <Link
                  href={`/studio/${row.id}`}
                  className="type-title underline-offset-4 hover:underline"
                >
                  {row.title}
                </Link>
                {row.tagline && (
                  <p className="type-body-sm measure-ui mt-1 text-ink-muted">
                    {row.tagline}
                  </p>
                )}
              </td>
              <td className="type-caption border-b border-hairline-soft px-4 py-4">
                {row.section_count}
              </td>
              <td className="type-caption border-b border-hairline-soft px-4 py-4">
                {row.chip_count}
              </td>
              <td className="type-caption border-b border-hairline-soft px-4 py-4">
                {row.quiz_count}
              </td>
              <td className="border-b border-hairline-soft px-4 py-4">
                <StatusCell row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
