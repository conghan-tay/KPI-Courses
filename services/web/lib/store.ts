import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { CourseSchema, type Course } from "@/lib/types";
import { slugify } from "@/lib/text";

/**
 * Persistence for the POC. The real data model in POC_UserJourney.md §1 is
 * Postgres; this is a JSON file behind an interface, because Journey 1 needs
 * somewhere to keep a draft between three screens and nothing more.
 *
 * Everything the app does goes through `CourseStore`, so swapping this for the
 * Go gateway's `/api/courses/*` or a real database is one implementation, not
 * a rewrite.
 */
export interface CourseStore {
  list(specialistId?: string): Promise<Course[]>;
  get(id: string): Promise<Course | null>;
  getBySlug(slug: string): Promise<Course | null>;
  create(course: Course): Promise<Course>;
  /** Read-modify-write under the store's lock. Returns null for unknown ids. */
  update(
    id: string,
    mutate: (course: Course) => Course
  ): Promise<Course | null>;
  remove(id: string): Promise<boolean>;
}

const DATA_DIR =
  process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "courses.json");

class JsonFileCourseStore implements CourseStore {
  /**
   * A promise chain, not a real lock. Node runs this handler single-threaded,
   * so serialising read-modify-write through one chain is enough to stop two
   * concurrent PATCHes from clobbering each other in dev. A second process
   * would need a real database — which is the point at which this class gets
   * replaced.
   */
  private queue: Promise<unknown> = Promise.resolve();

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async readAll(): Promise<Course[]> {
    try {
      const raw = await readFile(DATA_FILE, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // A row that no longer parses is dropped rather than crashing the studio.
      return parsed.flatMap((row) => {
        const course = CourseSchema.safeParse(row);
        return course.success ? [course.data] : [];
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeAll(courses: Course[]): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    // Write-then-rename so a crash mid-write cannot truncate the file.
    const temporary = `${DATA_FILE}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(courses, null, 2), "utf8");
    await rename(temporary, DATA_FILE);
  }

  async list(specialistId?: string): Promise<Course[]> {
    const courses = await this.readAll();
    const scoped = specialistId
      ? courses.filter((course) => course.specialist_id === specialistId)
      : courses;
    return scoped.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async get(id: string): Promise<Course | null> {
    const courses = await this.readAll();
    return courses.find((course) => course.id === id) ?? null;
  }

  async getBySlug(slug: string): Promise<Course | null> {
    const courses = await this.readAll();
    return courses.find((course) => course.slug === slug) ?? null;
  }

  create(course: Course): Promise<Course> {
    return this.serialize(async () => {
      const courses = await this.readAll();
      const stored = { ...course, slug: uniqueSlug(course.slug, courses) };
      await this.writeAll([...courses, stored]);
      return stored;
    });
  }

  update(
    id: string,
    mutate: (course: Course) => Course
  ): Promise<Course | null> {
    return this.serialize(async () => {
      const courses = await this.readAll();
      const index = courses.findIndex((course) => course.id === id);
      if (index === -1) return null;

      const updated: Course = {
        ...mutate(courses[index]),
        id: courses[index].id,
        updated_at: new Date().toISOString(),
      };
      courses[index] = updated;
      await this.writeAll(courses);
      return updated;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.serialize(async () => {
      const courses = await this.readAll();
      const remaining = courses.filter((course) => course.id !== id);
      if (remaining.length === courses.length) return false;
      await this.writeAll(remaining);
      return true;
    });
  }
}

function uniqueSlug(desired: string, existing: Course[]): string {
  const base = slugify(desired);
  const taken = new Set(existing.map((course) => course.slug));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export const courseStore: CourseStore = new JsonFileCourseStore();

export function newCourseId(): string {
  return `course-${randomUUID().slice(0, 8)}`;
}
