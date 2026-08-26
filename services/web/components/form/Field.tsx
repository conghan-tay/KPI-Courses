"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * DESIGN.md §4.10 — an invalid field carries three signals, one of them
 * non-chromatic: the border turns alert, a hatch-filled strip appears on the
 * left edge, and a `body-s` message in alert explains it. Colour alone is never
 * the message.
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
    <div className={cn("flex flex-col gap-1.5", invalid && "pl-2.5", className)}>
      <div className={cn("relative flex flex-col gap-1.5", invalid && "pl-0")}>
        {invalid && (
          <span
            aria-hidden
            className="pat-hatch-alert absolute top-0 bottom-0 -left-2.5 w-1.5"
          />
        )}
        <label htmlFor={id} className="type-label">
          {label}
        </label>
        {children({
          id,
          "aria-invalid": invalid,
          "aria-describedby": error || hint ? messageId : undefined,
        })}
      </div>
      {(error || hint) && (
        <p
          id={messageId}
          className={cn("type-body-s", error ? "text-alert" : "text-ink-muted")}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
