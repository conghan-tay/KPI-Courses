import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Journey 1 end to end: documents → a published knowledge base.
 *
 * This runs against the whole stack — Next proxying to the Go API, Postgres,
 * Temporal, and a worker on MODEL_PROVIDER=fake replaying
 * docs/productDocs/fixtures. Deterministic, and no model key required.
 *
 * It assumes a clean database, which is what `make test-e2e` gives it: the
 * empty state is a designed screen and asserting it is worth the constraint.
 */

// Playwright runs with services/web as the working directory.
const FIXTURES = path.resolve(process.cwd(), "../../docs/productDocs/fixtures");
const DOCUMENTS = [
  "resume.md",
  "agoda-supplier-payouts.md",
  "agoda-psp-routing.md",
  "agoda-reconciliation.md",
  "postgres-notes.md",
  "nodusart-advisory.md",
  "career-notes.md",
].map((name) => path.join(FIXTURES, name));

test("a candidate turns documents into a published knowledge base", async ({
  page,
}) => {
  await page.goto("/studio");
  await expect(page.getByText("Nothing here yet. Build one.")).toBeVisible();

  await page.getByRole("link", { name: "Build one" }).first().click();
  await expect(page).toHaveURL(/\/studio\/new$/);

  // Dropping documents with frontmatter fills in the name and the one-liner.
  await page.setInputFiles('input[type="file"]', DOCUMENTS);
  await expect(page.getByText("resume.md")).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveValue("Arun Velasco");
  await expect(page.getByLabel("One line")).toHaveValue(
    "Payments engineer. Eleven years, four employers, one gap I'll tell you about."
  );

  await page.getByRole("button", { name: "Build my knowledge base" }).click();

  // No assertion on the streamed status lines here, deliberately. Replaying the
  // fixture takes about a second end to end, so the ingestion panel is gone
  // before a browser can reliably see it, and an assertion that passes on a slow
  // machine and fails on a fast one is worse than none. The status stream is
  // asserted frame by frame in tests/e2e/test_candidate_journey_e2e.py, which
  // reads the SSE response directly.

  // The review screen opens on Questions, with three of eight already chosen.
  await expect(page).toHaveURL(/\/studio\/kb-/);
  await expect(page.getByRole("heading", { name: "Arun Velasco" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Questions · 3\/3/ })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.getByText("On your front page").first()).toBeVisible();

  // The preview panel proves the withholding rule: three chips and a pre-roll,
  // and no quiz anywhere in the payload the panel was given.
  await expect(page.getByText("What a stranger sees")).toBeVisible();
  await expect(page.getByText("Your quiz answers never reach a browser")).toBeVisible();

  // Edit a question and let the debounce land.
  const question = page
    .getByRole("article", { name: "Question 1" })
    .getByLabel("What they type");
  await question.fill("what happens when a PSP dies mid-payout?");
  await expect(page.getByText("Saved")).toBeVisible();

  // The knowledge base carries every section, in order, with editable ids.
  await page.getByRole("tab", { name: /Knowledge base/ }).click();
  await expect(page.getByLabel("Title of section 1", { exact: true })).toHaveValue(
    "Timeline — eleven years, four employers, one gap"
  );
  await page.getByRole("button", { name: /Move section 1 down/ }).click();
  await expect(page.getByLabel("Title of section 2", { exact: true })).toHaveValue(
    "Timeline — eleven years, four employers, one gap"
  );

  // The quiz is grouped by the four categories the gate samples from.
  await page.getByRole("tab", { name: /Quiz · 12/ }).click();
  for (const category of ["Motivation", "Judgement", "Limits", "Substance"]) {
    await expect(page.getByRole("heading", { name: category })).toBeVisible();
  }
  await expect(page.getByText("3 / 3").first()).toBeVisible();

  // The pre-roll renders live inside the card it will actually appear in.
  await page.getByRole("tab", { name: "Pre-roll" }).click();
  await expect(
    page.getByText("$3.00 + model cost. Meter visible throughout.")
  ).toBeVisible();

  // Preview renders the recruiter's landing view.
  await page.getByRole("button", { name: "Preview as a recruiter" }).click();
  await expect(page).toHaveURL(/\/preview$/);
  await expect(
    page.getByText("Preview. Nothing here is live yet.")
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Knowledge base" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start my hour" })).toBeDisabled();

  // Publish, and get a shareable link back.
  await page.getByRole("link", { name: "Back to editing" }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("heading", { name: "It's live" })).toBeVisible();
  await expect(
    page.getByText(/http:\/\/localhost:3000\/k\/arun-velasco/)
  ).toBeVisible();

  await page.getByRole("button", { name: "Back to editing" }).click();
  await page.goto("/studio");
  await expect(page.getByText("Published")).toBeVisible();

  // The edit survived the round trip to Postgres, which the in-page optimistic
  // update would have hidden.
  await page.getByRole("link", { name: /Arun Velasco/ }).first().click();
  await expect(
    page.getByRole("article", { name: "Question 1" }).getByLabel("What they type")
  ).toHaveValue("what happens when a PSP dies mid-payout?");
});

test("the public page never ships the quiz to an unauthenticated reader", async ({
  request,
}) => {
  const list = await request.get("/api/kb");
  const { knowledge_bases } = await list.json();
  expect(knowledge_bases.length).toBeGreaterThan(0);

  const response = await request.get(
    `/api/kb/${knowledge_bases[0].id}?audience=public`
  );
  const { knowledge_base } = await response.json();
  const body = await response.text();

  // Withheld by the Go API, not hidden in CSS. The quiz is the gate protecting
  // twenty minutes of the candidate's real time, so a leaked `correct_index`
  // would make the whole of Journey 3 decorative.
  expect(knowledge_base).not.toHaveProperty("quiz");
  expect(knowledge_base.chips).toHaveLength(3);
  expect(knowledge_base.chips[0]).toHaveProperty("text");
  expect(knowledge_base.chips[0]).not.toHaveProperty("why_it_lands");
  expect(knowledge_base.sections[0]).not.toHaveProperty("body_md");

  for (const withheld of [
    '"quiz":',
    '"correct_index":',
    '"rationale":',
    '"why_it_lands":',
    '"body_md":',
    '"source_text":',
  ]) {
    expect(body).not.toContain(withheld);
  }
});
