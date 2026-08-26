import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

import { readFixture } from "@/lib/ingest/fixture";
import {
  INGESTION_SYSTEM_PROMPT,
  ingestionUserPrompt,
} from "@/lib/ingest/prompt";
import { IngestResultSchema, type IngestResult } from "@/lib/types";

/**
 * One LLM call turns a folder of messy notes into a course
 * (POC_UserJourney.md § Journey 1). Two modes:
 *
 *   mock  replays docs/productDocs/fixtures/expected.json with a staged status
 *         stream. No API key, deterministic, and it is what CI runs.
 *   live  makes the real call, using the same MODEL_PROVIDER / MODEL_NAME
 *         convention as the Python worker in this repo.
 *
 * Swapping this for the Go gateway's ingestion endpoint means replacing
 * `runIngestion` and nothing else.
 */

export type IngestMode = "mock" | "live";

export type IngestInput = {
  specialistName: string;
  title: string;
  tagline: string;
  sourceText: string;
  fileNames: string[];
};

/** Streamed to the ingestion panel as `meta` lines. Never a percentage. */
export type StatusEmitter = (message: string) => void;

export class IngestError extends Error {
  constructor(
    readonly code: "model_error" | "timeout" | "bad_output" | "forced",
    message: string
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export function ingestMode(): IngestMode {
  return process.env.INGEST_MODE === "live" ? "live" : "mock";
}

function delayMs(): number {
  const raw = Number(process.env.INGEST_MOCK_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 700;
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export async function runIngestion(
  input: IngestInput,
  emit: StatusEmitter
): Promise<IngestResult> {
  // An explicit lever for demoing the failure state: the draft survives and the
  // review screen offers a retry.
  if (process.env.INGEST_FORCE_ERROR === "1") {
    emit("READING SOURCE…");
    await sleep(delayMs());
    throw new IngestError("forced", "Ingestion failed (INGEST_FORCE_ERROR=1).");
  }

  return ingestMode() === "live"
    ? runLiveIngestion(input, emit)
    : runMockIngestion(input, emit);
}

async function runMockIngestion(
  input: IngestInput,
  emit: StatusEmitter
): Promise<IngestResult> {
  const pause = delayMs();
  const files = input.fileNames.length ? input.fileNames : ["pasted text"];

  for (const [index, name] of files.entries()) {
    emit(`READING ${index + 1} OF ${files.length} FILES · ${name}`);
    await sleep(pause);
  }

  const fixture = await readFixture();

  emit("SEPARATING OPINION FROM CRAFT…");
  await sleep(pause);
  emit(`EXTRACTING POSITIONS · ${fixture.positions.length} FOUND`);
  await sleep(pause);

  for (const [index, lesson] of fixture.lessons.entries()) {
    emit(
      `WRITING LESSON ${index + 1} OF ${fixture.lessons.length} · ${lesson.title}`
    );
    await sleep(pause);
  }

  emit("READING VOICE…");
  await sleep(pause);

  return {
    lessons: fixture.lessons,
    voice_card: fixture.voice_card,
    positions: fixture.positions,
  };
}

function resolveModel() {
  const name = process.env.MODEL_NAME ?? "claude-opus-5";
  const provider = process.env.MODEL_PROVIDER ?? "anthropic";

  switch (provider) {
    case "anthropic":
      return {
        name,
        model: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(name),
      };
    case "openai":
      return {
        name,
        model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(name),
      };
    default:
      throw new IngestError(
        "model_error",
        `MODEL_PROVIDER=${provider} is not supported by ingestion. Use "anthropic" or "openai".`
      );
  }
}

async function runLiveIngestion(
  input: IngestInput,
  emit: StatusEmitter
): Promise<IngestResult> {
  const files = input.fileNames.length ? input.fileNames : ["pasted text"];
  emit(`READING ${files.length} FILE${files.length === 1 ? "" : "S"}…`);

  const { model, name } = resolveModel();
  const words = input.sourceText.split(/\s+/).length;
  emit(`SENDING ${words.toLocaleString()} WORDS TO ${name.toUpperCase()}…`);

  const timeout = Number(process.env.INGEST_TIMEOUT_MS ?? 180_000);
  const abort = AbortSignal.timeout(timeout);

  let object: unknown;
  try {
    const result = await generateObject({
      model,
      schema: IngestResultSchema,
      system: INGESTION_SYSTEM_PROMPT,
      prompt: ingestionUserPrompt(input),
      abortSignal: abort,
    });
    object = result.object;
  } catch (error) {
    if (abort.aborted) {
      throw new IngestError(
        "timeout",
        `The model did not answer within ${Math.round(timeout / 1000)}s.`
      );
    }
    throw new IngestError(
      "model_error",
      error instanceof Error ? error.message : "The model call failed."
    );
  }

  emit("CHECKING QUOTE ANCHORS…");

  const parsed = IngestResultSchema.safeParse(object);
  if (!parsed.success) {
    throw new IngestError(
      "bad_output",
      "The model returned a course in the wrong shape."
    );
  }

  return parsed.data;
}

/**
 * `Soften` on a position card. In live mode this is one small rewrite; in mock
 * mode the caller falls back to inline editing, so the button is never dead.
 */
export async function softenClaim(claim: string): Promise<string> {
  const { model } = resolveModel();
  const { object } = await generateObject({
    model,
    schema: z.object({ claim: z.string() }),
    prompt: [
      "Rewrite this claim so it is still the author's position but less",
      "absolute — hedge the universal, keep the edge. One sentence. Do not",
      "make it agreeable or balanced; a position nobody could disagree with",
      "is worthless.",
      "",
      `Claim: ${claim}`,
    ].join("\n"),
  });
  return object.claim;
}
