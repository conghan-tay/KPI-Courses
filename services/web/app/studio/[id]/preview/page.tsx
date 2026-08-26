import { notFound } from "next/navigation";

import { AppFrame } from "@/components/frame/AppFrame";
import { ButtonLink } from "@/components/ui/button";
import { LearnPreview } from "@/components/learn/LearnPreview";
import { Notice } from "@/components/riso/Notice";
import { SectionHead } from "@/components/riso/SectionHead";
import { getMyCourse } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PreviewPage(
  props: PageProps<"/studio/[id]/preview">
) {
  const { id } = await props.params;
  const course = await getMyCourse(id);
  if (!course) notFound();

  return (
    <AppFrame variant="fixed">
      <SectionHead
        title="Preview"
        note={`${course.lessons.length} lessons`}
        actions={
          <ButtonLink variant="ghost" href={`/studio/${course.id}`}>
            Back to the course
          </ButtonLink>
        }
      />

      {course.lessons.length === 0 ? (
        <Notice label="Nothing to preview">
          This course has no lessons yet.
        </Notice>
      ) : (
        <div className="flex flex-col gap-6">
          <LearnPreview course={course} />
          <p className="type-body-s measure-ui text-ink-muted">
            The furniture is real — rail, progress, citations, composer. The
            conversation itself arrives with Journey 3, so nothing here talks
            back yet.
          </p>
        </div>
      )}
    </AppFrame>
  );
}
