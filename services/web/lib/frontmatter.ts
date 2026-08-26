/**
 * Minimal YAML frontmatter reader — enough for `title:`, `tagline:` and
 * `price_cents:` in docs/productDocs/fixtures/source.md, so dropping the
 * fixture prefills the form instead of making you retype it. Nested keys and
 * lists are ignored rather than half-parsed.
 *
 * It lives in its own module because both the server (extraction) and the
 * browser (form prefill) use it, and the extraction module pulls in a PDF
 * parser that has no business in a client bundle.
 */
export function splitFrontmatter(input: string): {
  body: string;
  meta: Record<string, string>;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(input);
  if (!match) return { body: input, meta: {} };

  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_]+):\s*(.+)$/.exec(line);
    if (!pair) continue;
    meta[pair[1]] = pair[2].trim().replace(/^["']|["']$/g, "");
  }

  return { body: input.slice(match[0].length), meta };
}
