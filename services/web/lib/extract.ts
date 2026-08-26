import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

import { splitFrontmatter } from "@/lib/frontmatter";

// POC_UserJourney.md §0 — "Markdown, `.txt`, and PDF-with-a-text-layer. Reject
// scans and video." The rejection is a designed screen, not an error toast:
// a scan comes back with `no_text_layer` and the dropzone says
// "This looks like a scan. Paste the text instead."

export type ExtractErrorCode =
  | "no_text_layer"
  | "unsupported_type"
  | "empty_file"
  | "unreadable";

export class ExtractError extends Error {
  constructor(
    readonly code: ExtractErrorCode,
    message: string,
    readonly fileName?: string
  ) {
    super(message);
    this.name = "ExtractError";
  }
}

const TEXT_EXTENSIONS = [".md", ".markdown", ".txt", ".text"];

/** A PDF page of pure images still yields a few stray characters. */
const MIN_PDF_CHARS = 40;

export type ExtractedFile = {
  name: string;
  text: string;
  /** YAML frontmatter values, when the file carries any. */
  meta: Record<string, string>;
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

export function isSupportedFile(name: string): boolean {
  const extension = extensionOf(name);
  return TEXT_EXTENSIONS.includes(extension) || extension === ".pdf";
}

export async function extractFile(file: File): Promise<ExtractedFile> {
  const name = file.name || "pasted.txt";

  if (file.size === 0) {
    throw new ExtractError("empty_file", `${name} is empty.`, name);
  }

  const extension = extensionOf(name);

  if (TEXT_EXTENSIONS.includes(extension)) {
    const raw = await file.text();
    const { body, meta } = splitFrontmatter(raw);
    return { name, text: body.trim(), meta };
  }

  if (extension === ".pdf") {
    let text: string;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const extracted = await extractPdfText(pdf, { mergePages: true });
      text = extracted.text.trim();
    } catch {
      throw new ExtractError(
        "unreadable",
        `${name} could not be opened as a PDF.`,
        name
      );
    }

    if (text.replace(/\s/g, "").length < MIN_PDF_CHARS) {
      throw new ExtractError(
        "no_text_layer",
        `${name} has no text layer.`,
        name
      );
    }

    return { name, text, meta: {} };
  }

  throw new ExtractError(
    "unsupported_type",
    `${name} isn't markdown, plain text, or a PDF.`,
    name
  );
}

/**
 * Concatenate every dropped file into the one corpus the ingestion prompt
 * sees, with a header per file so the model can tell a manuscript from a
 * podcast transcript — which is what assertion A3 (the disagreeing guest)
 * depends on.
 */
export function joinCorpus(files: ExtractedFile[]): string {
  return files
    .map((file) => `# SOURCE FILE: ${file.name}\n\n${file.text}`)
    .join("\n\n---\n\n");
}
