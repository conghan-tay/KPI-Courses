import { readFile } from "node:fs/promises";
import path from "node:path";

import { FixtureSchema } from "@/lib/types";

/**
 * The reference ingestion case lives in docs/productDocs/fixtures/ and is the
 * single source of truth for mock mode, the seed script and the unit tests —
 * so it is read from disk rather than copied into this app. `FIXTURE_DIR` lets
 * the container image point at wherever the docs were copied to.
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
