import { AppFrame } from "@/components/frame/AppFrame";
import { ButtonLink } from "@/components/ui/button";
import { CourseTable } from "@/components/studio/CourseTable";
import { EmptyState } from "@/components/riso/EmptyState";
import { SectionHead } from "@/components/riso/SectionHead";
import { listMyCourses } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const [user, courses] = await Promise.all([getCurrentUser(), listMyCourses()]);

  return (
    <AppFrame>
      <SectionHead
        title="Your courses"
        note={`${user.name} · ${courses.length} total`}
        actions={
          <ButtonLink variant="accent" size="lg" href="/studio/new">
            Build a course
          </ButtonLink>
        }
      />

      {courses.length === 0 ? (
        <EmptyState
          title="No courses yet. Make one."
          note="Drop in whatever you already wrote — a manuscript, transcripts, an AMA thread. Ten minutes to a live course."
          action={
            <ButtonLink variant="accent" href="/studio/new">
              Build a course
            </ButtonLink>
          }
        />
      ) : (
        <CourseTable courses={courses} />
      )}
    </AppFrame>
  );
}
