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

export async function readFixture() {
  const raw = await readFile(path.join(FIXTURE_DIR, "expected.json"), "utf8");
  return FixtureSchema.parse(JSON.parse(raw));
}

export async function readFixtureSource(): Promise<string> {
  return readFile(path.join(FIXTURE_DIR, "source.md"), "utf8");
}
