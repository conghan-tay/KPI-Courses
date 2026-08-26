import { AppFrame } from "@/components/frame/AppFrame";
import { ButtonLink } from "@/components/ui/button";
import { NewCourseForm } from "@/components/studio/NewCourseForm";
import { SectionHead } from "@/components/riso/SectionHead";

export default function NewCoursePage() {
  return (
    <AppFrame>
      <SectionHead
        title="Build a course"
        note="Step 1 of 3"
        actions={
          <ButtonLink variant="ghost" href="/studio">
            Back to studio
          </ButtonLink>
        }
      />
      <NewCourseForm />
    </AppFrame>
  );
}
