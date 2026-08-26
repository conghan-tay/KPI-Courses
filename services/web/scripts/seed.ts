/**
 * Puts the reference course into the store as a draft, so /studio has
 * something in it without running ingestion first.
 *
 *   npm run seed
 *
 * The studio's empty state is a designed screen, so this is opt-in: a fresh
 * checkout starts with "No courses yet. Make one."
 */
import { applyIngestResult, newDraftCourse } from "@/lib/courses";
import { readFixture, readFixtureSource } from "@/lib/ingest/fixture";
import { courseStore } from "@/lib/store";
import { SEEDED_USERS } from "@/lib/seed";
import { splitFrontmatter } from "@/lib/frontmatter";

async function main() {
  const specialist = SEEDED_USERS.find((user) => user.role === "specialist")!;
  const fixture = await readFixture();
  const { body } = splitFrontmatter(await readFixtureSource());

  const existing = await courseStore.getBySlug(fixture.course.slug);
  if (existing) {
    console.log(`Already seeded: ${existing.title} (${existing.id})`);
    return;
  }

  const draft = newDraftCourse({
    user: specialist,
    meta: {
      title: fixture.course.title,
      tagline: fixture.course.tagline,
      price_cents: fixture.course.price_cents,
    },
    sourceText: body,
    sourceFiles: ["source.md"],
  });

  const created = await courseStore.create(
    applyIngestResult(draft, {
      lessons: fixture.lessons,
      voice_card: fixture.voice_card,
      positions: fixture.positions,
    })
  );

  console.log(
    `Seeded "${created.title}" — ${created.lessons.length} lessons, ${created.positions.length} stances.`
  );
  console.log(`  /studio/${created.id}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
