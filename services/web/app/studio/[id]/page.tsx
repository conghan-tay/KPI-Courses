import { notFound } from "next/navigation";

import { AppFrame } from "@/components/frame/AppFrame";
import { ReviewScreen } from "@/components/studio/ReviewScreen";
import { auditAnchors } from "@/lib/quotes";
import { getMyCourse } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ReviewPage(props: PageProps<"/studio/[id]">) {
  const { id } = await props.params;
  const course = await getMyCourse(id);
  if (!course) notFound();

  // The quote-anchor audit runs on the server: `source_text` can be hundreds of
  // kilobytes and the browser has no reason to hold it. Claims rather than
  // indexes, so the warnings survive a reorder — and disappear the moment the
  // Specialist rewrites the claim and takes ownership of it.
  const audit = auditAnchors(course.positions, course.source_text);
  const unanchoredClaims = audit.unanchored.map(
    (index) => course.positions[index].claim
  );

  return (
    <AppFrame variant="fixed">
      <ReviewScreen initialCourse={course} unanchoredClaims={unanchoredClaims} />
    </AppFrame>
  );
}
