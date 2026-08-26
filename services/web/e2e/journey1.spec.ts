import path from "node:path";
import { rm } from "node:fs/promises";
import { expect, test } from "@playwright/test";

/**
 * Journey 1 end to end: raw material → published course.
 *
 * Runs against INGEST_MODE=mock so the whole thing is deterministic and needs
 * no API key — see playwright.config.ts.
 */

// Playwright runs with services/web as the working directory.
const FIXTURE = path.resolve(
  process.cwd(),
  "../../docs/productDocs/fixtures/source.md"
);

const DATA_DIR = path.resolve(process.cwd(), ".data-e2e");

test.beforeAll(async () => {
  // Start from the designed empty state every run.
  await rm(DATA_DIR, { recursive: true, force: true });
});

test("a specialist turns raw material into a published course", async ({
  page,
}) => {
  await page.goto("/studio");
  await expect(page.getByText("No courses yet. Make one.")).toBeVisible();

  await page.getByRole("link", { name: "Build a course" }).first().click();
  await expect(page).toHaveURL(/\/studio\/new$/);

  // Dropping a file with frontmatter fills in title, tagline and price.
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByText("source.md")).toBeVisible();
  await expect(page.getByLabel("Course title")).toHaveValue("Hold Your Number");
  await expect(page.getByLabel("Price")).toHaveValue("349");

  await page.getByRole("button", { name: "Build my course" }).click();

  // The review screen opens on Positions, with the seven stances from the
  // fixture — assertion A7's expected count.
  await expect(page).toHaveURL(/\/studio\/course-/);
  await expect(page.getByRole("heading", { name: "Hold Your Number" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Positions · 7/ })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.getByText("Stance 1")).toBeVisible();

  // The preview panel proves the withholding rule: the public projection has
  // claims and a lock, and no argument anywhere in the payload.
  await expect(page.getByText("What a stranger sees")).toBeVisible();
  await expect(page.getByText("Unlock").first()).toBeVisible();

  // Edit a claim and let the debounce land.
  const claim = page.getByLabel("Claim for stance 1");
  await claim.fill("A price objection is never actually about price.");
  await expect(page.getByText("Saved")).toBeVisible();

  // The syllabus carries all seven lessons in order.
  await page.getByRole("tab", { name: /Syllabus/ }).click();
  await expect(page.getByLabel("Title of lesson 1")).toHaveValue(
    "The Objection You Hear Is Not The One You Have"
  );
  await page.getByRole("button", { name: /Move .* down/ }).first().click();
  await expect(page.getByLabel("Title of lesson 2")).toHaveValue(
    "The Objection You Hear Is Not The One You Have"
  );

  // Preview renders the real rail and the opening diagnostic.
  await page.getByRole("button", { name: "Preview as a student" }).click();
  await expect(page).toHaveURL(/\/preview$/);
  await expect(page.getByText("Preview — not live").first()).toBeVisible();
  await expect(
    page.getByText(/what's the thing you're actually trying to do/i)
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Syllabus" })).toBeVisible();

  // Publish, and get a shareable link back.
  await page.getByRole("link", { name: "Back to the course" }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("heading", { name: "It's live" })).toBeVisible();
  await expect(page.getByText(/\/c\/hold-your-number/)).toBeVisible();

  await page.getByRole("button", { name: "Back to the course" }).click();
  await page.goto("/studio");
  await expect(page.getByText("Published")).toBeVisible();
});

test("a course page never ships the argument to an unauthenticated reader", async ({
  request,
}) => {
  const list = await request.get("/api/courses");
  const { courses } = await list.json();
  expect(courses.length).toBeGreaterThan(0);

  const response = await request.get(
    `/api/courses/${courses[0].id}?audience=public`
  );
  const { course } = await response.json();
  const body = await (
    await request.get(`/api/courses/${courses[0].id}?audience=public`)
  ).text();

  // DESIGN.md §4.5 — withheld on the server, not blurred in CSS. Assert on the
  // keys, and on a phrase from the fixture's argument that must never appear.
  expect(course.positions[0]).toHaveProperty("claim");
  expect(course.positions[0]).not.toHaveProperty("because");
  expect(course.positions[0]).not.toHaveProperty("pushback");
  expect(course.lessons[0]).not.toHaveProperty("body_md");
  expect(course).not.toHaveProperty("source_text");
  expect(course).not.toHaveProperty("voice_card");
  expect(body).not.toContain("Every pricing problem arrives disguised");
});
