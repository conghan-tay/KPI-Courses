"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * NEW_DESIGN.md §6.6 — label above at 14/500 sentence case, helper below the
 * label, error below the field. Never placeholder-as-label.
 *
 * An invalid field carries two signals: the border turns danger and a message
 * in danger explains it. The old system added a hatch-filled gutter stripe as a
 * third, non-chromatic signal; this one drops the pattern because a message in
 * words is already non-chromatic and the stripe cost 10px of every field's
 * width.
 *
 * `children` receives the generated id so the label is always wired to a real
 * control, and `aria-invalid` is set from the same source as the visible state.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (props: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby"?: string;
  }) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const messageId = `${id}-message`;
  const invalid = Boolean(error);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="type-label text-ink">
        {label}
      </label>
      {hint && !error && (
        <p id={messageId} className="type-body-sm -mt-1 text-ink-muted">
          {hint}
        </p>
      )}
      {children({
        id,
        "aria-invalid": invalid,
        "aria-describedby": error || hint ? messageId : undefined,
      })}
      {error && (
        <p id={messageId} className="type-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
