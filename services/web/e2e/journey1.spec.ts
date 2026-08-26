import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Journey 1 end to end: raw material → published course.
 *
 * This runs against the whole stack — Next proxying to the Go API, Postgres,
 * Temporal, and a worker on MODEL_PROVIDER=fake replaying
 * docs/productDocs/fixtures. Deterministic, and no model key required.
 *
 * It assumes a clean database, which is what `make test-e2e` gives it: the
 * empty state is a designed screen and asserting it is worth the constraint.
 */

// Playwright runs with services/web as the working directory.
const FIXTURE = path.resolve(
  process.cwd(),
  "../../docs/productDocs/fixtures/source.md"
);

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

  // No assertion on the streamed status lines here, deliberately. Replaying the
  // fixture takes about a second end to end, so the ingestion panel is gone
  // before a browser can reliably see it, and an assertion that passes on a slow
  // machine and fails on a fast one is worse than none. The status stream is
  // asserted frame by frame in tests/e2e/test_journey1_e2e.py, which reads the
  // SSE response directly.

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

  // The edit survived the round trip to Postgres, which the in-page optimistic
  // update would have hidden.
  await page.getByRole("link", { name: /Hold Your Number/ }).first().click();
  await expect(page.getByLabel("Claim for stance 1")).toHaveValue(
    "A price objection is never actually about price."
  );
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
  const body = await response.text();

  // DESIGN.md §4.5 — withheld by the Go API, not blurred in CSS. Assert on the
  // keys, and on a phrase from the fixture's argument that must never appear.
  expect(course.positions[0]).toHaveProperty("claim");
  expect(course.positions[0]).not.toHaveProperty("because");
  expect(course.positions[0]).not.toHaveProperty("pushback");
  expect(course.lessons[0]).not.toHaveProperty("body_md");
  expect(course).not.toHaveProperty("source_text");
  expect(course).not.toHaveProperty("voice_card");
  expect(body).not.toContain("Every pricing problem arrives disguised");
});
