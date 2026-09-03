import { notFound } from "next/navigation";

import { AppFrame } from "@/components/frame/AppFrame";
import { ReviewScreen } from "@/components/studio/ReviewScreen";
import { getMyKnowledgeBase } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ReviewPage(props: PageProps<"/studio/[id]">) {
  const { id } = await props.params;
  const knowledgeBase = await getMyKnowledgeBase(id);
  if (!knowledgeBase) notFound();

  // The reference audit runs on the client rather than here, unlike the quote
  // audit it replaces. Section ids are short, the whole check is a set lookup,
  // and — the deciding reason — deleting a section is how a candidate orphans
  // three questions, so the warning has to appear as they do it rather than on
  // the next page load.
  return (
    <AppFrame variant="fixed">
      <ReviewScreen initial={knowledgeBase} />
    </AppFrame>
  );
}
