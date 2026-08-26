import { describe, expect, it } from "vitest";

import { ExtractError, extractFile, isSupportedFile, joinCorpus } from "@/lib/extract";
import { splitFrontmatter } from "@/lib/frontmatter";

function file(name: string, content: string): File {
  return new File([content], name, { type: "text/plain" });
}

describe("isSupportedFile", () => {
  it.each([
    ["notes.md", true],
    ["NOTES.MD", true],
    ["transcript.txt", true],
    ["manuscript.pdf", true],
    ["talk.mp4", false],
    ["deck.pptx", false],
    ["noextension", false],
  ])("%s → %s", (name, expected) => {
    expect(isSupportedFile(name)).toBe(expected);
  });
});

describe("extractFile", () => {
  it("reads markdown and strips frontmatter into meta", async () => {
    const extracted = await extractFile(
      file(
        "source.md",
        '---\ntitle: "Hold Your Number"\nprice_cents: 34900\n---\n\n# Part 1\n\nBody text.'
      )
    );

    expect(extracted.meta.title).toBe("Hold Your Number");
    expect(extracted.meta.price_cents).toBe("34900");
    expect(extracted.text).toBe("# Part 1\n\nBody text.");
    expect(extracted.text).not.toContain("price_cents");
  });

  it("rejects an empty file", async () => {
    await expect(extractFile(file("empty.txt", ""))).rejects.toBeInstanceOf(
      ExtractError
    );
  });

  it("rejects a file type the ingestion prompt can't read", async () => {
    await expect(extractFile(file("talk.mp4", "x"))).rejects.toMatchObject({
      code: "unsupported_type",
    });
  });

  it("rejects a PDF that isn't a PDF", async () => {
    const notAPdf = new File(["not really a pdf"], "scan.pdf", {
      type: "application/pdf",
    });
    await expect(extractFile(notAPdf)).rejects.toMatchObject({
      code: "unreadable",
    });
  });
});

describe("splitFrontmatter", () => {
  it("returns the input untouched when there is no frontmatter", () => {
    expect(splitFrontmatter("# Just a heading")).toEqual({
      body: "# Just a heading",
      meta: {},
    });
  });

  it("ignores list and nested keys rather than half-parsing them", () => {
    const { meta } = splitFrontmatter(
      "---\ntitle: One\nsource_files:\n  - a.md\n  - b.md\n---\nbody"
    );
    expect(meta).toEqual({ title: "One" });
  });

  it("strips surrounding quotes", () => {
    const { meta } = splitFrontmatter(`---\ntagline: "A line."\n---\nbody`);
    expect(meta.tagline).toBe("A line.");
  });
});

describe("joinCorpus", () => {
  // A3, the attribution trap: the model can only tell a manuscript from a
  // guest interview if the file boundaries survive into the prompt.
  it("labels each file so the model can tell them apart", () => {
    const corpus = joinCorpus([
      { name: "manuscript.md", text: "chapter one", meta: {} },
      { name: "guest-episode.txt", text: "the guest disagrees", meta: {} },
    ]);

    expect(corpus).toContain("# SOURCE FILE: manuscript.md");
    expect(corpus).toContain("# SOURCE FILE: guest-episode.txt");
    expect(corpus.indexOf("chapter one")).toBeLessThan(
      corpus.indexOf("the guest disagrees")
    );
  });
});
