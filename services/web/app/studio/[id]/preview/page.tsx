import { notFound } from "next/navigation";

import { AppFrame } from "@/components/frame/AppFrame";
import { ButtonLink } from "@/components/ui/button";
import { RecruiterPreview } from "@/components/interview/RecruiterPreview";
import { SectionHead } from "@/components/riso/SectionHead";
import { getMyKnowledgeBase } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PreviewPage(
  props: PageProps<"/studio/[id]/preview">
) {
  const { id } = await props.params;
  const knowledgeBase = await getMyKnowledgeBase(id);
  if (!knowledgeBase) notFound();

  return (
    <AppFrame variant="fixed">
      <SectionHead
        title="As a recruiter sees it"
        note="Nothing here is live yet"
        actions={
          <ButtonLink variant="ghost" href={`/studio/${knowledgeBase.id}`}>
            Back to editing
          </ButtonLink>
        }
      />
      <RecruiterPreview knowledgeBase={knowledgeBase} />
    </AppFrame>
  );
}
