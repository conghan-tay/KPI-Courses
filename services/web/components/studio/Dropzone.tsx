"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// DESIGN.md §11 — 3px dashed black border (the only dashed border in the
// system), halftone fill, 240px tall. §4.14 — the copy never sits on the
// halftone; it floats in a paper box on top of it.

const ACCEPT = ".md,.markdown,.txt,.text,.pdf";

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Dropzone({
  files,
  onAdd,
  onRemove,
  disabled,
}: {
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (disabled) return;
          onAdd(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          "grid min-h-50 place-items-center rounded-xl border-2 border-dashed border-hairline bg-surface p-6 transition-colors duration-120 ease-out",
          dragging && "bg-live-wash"
        )}
      >
        <div className="flex flex-col items-center gap-2.5 border border-hairline bg-surface px-6 py-5 text-center">
          <p className="type-title">Drop your material here.</p>
          <p className="type-body-sm text-ink-muted">
            Markdown, plain text, or a PDF with a real text layer.
          </p>
          <Button
            variant="primary"
            className="mt-1"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            Choose files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            onChange={(event) => {
              onAdd(Array.from(event.target.files ?? []));
              // Reset so re-picking the same file still fires a change.
              event.target.value = "";
            }}
          />
        </div>
      </div>

      {files.length > 0 && (
        <ul className="flex flex-col border border-hairline">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-4 border-b border-hairline px-4 py-3 last:border-b-0"
            >
              <span className="type-body flex-1 truncate">{file.name}</span>
              <span className="type-caption text-ink-muted">
                {sizeLabel(file.size)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() => onRemove(index)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
