import { AppFrame } from "@/components/frame/AppFrame";
import { ButtonLink } from "@/components/ui/button";
import { NewKBForm } from "@/components/studio/NewKBForm";
import { SectionHead } from "@/components/chrome/SectionHead";

export default function NewKnowledgeBasePage() {
  return (
    <AppFrame>
      <SectionHead
        title="Build a knowledge base"
        note="Step 1 of 3"
        actions={
          <ButtonLink variant="ghost" href="/studio">
            Back to studio
          </ButtonLink>
        }
      />
      <NewKBForm />
    </AppFrame>
  );
}
