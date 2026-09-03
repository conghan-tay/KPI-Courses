import { readFile } from "node:fs/promises";
import path from "node:path";

import { FixtureSchema } from "@/lib/types";

/**
 * The reference ingestion case lives in docs/productDocs/fixtures/. It is read
 * from disk rather than copied in, so there is exactly one copy of it and the
 * Go, Python and TypeScript assertions are all checking the same bytes.
 *
 * Test-only. Ingestion itself runs in the Python worker, which replays this same
 * file when MODEL_PROVIDER=fake.
 */
const FIXTURE_DIR =
  process.env.FIXTURE_DIR ??
  path.resolve(process.cwd(), "../../docs/productDocs/fixtures");

/** The seven documents the dropzone sends, in order. */
export const FIXTURE_FILES = [
  "resume.md",
  "agoda-supplier-payouts.md",
  "agoda-psp-routing.md",
  "agoda-reconciliation.md",
  "postgres-notes.md",
  "nodusart-advisory.md",
  "career-notes.md",
];

export async function readFixture() {
  const raw = await readFile(path.join(FIXTURE_DIR, "expected.json"), "utf8");
  return FixtureSchema.parse(JSON.parse(raw));
}

export function fixturePath(name: string): string {
  return path.join(FIXTURE_DIR, name);
}

export async function readFixtureDocument(name: string): Promise<string> {
  return readFile(fixturePath(name), "utf8");
}
