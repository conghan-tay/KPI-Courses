import { AppFrame } from "@/components/frame/AppFrame";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/chrome/EmptyState";
import { KBTable } from "@/components/studio/KBTable";
import { SectionHead } from "@/components/chrome/SectionHead";
import { listMyKnowledgeBases } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const [user, rows] = await Promise.all([
    getCurrentUser(),
    listMyKnowledgeBases(),
  ]);

  return (
    <AppFrame>
      <SectionHead
        title="Your knowledge bases"
        note={`${user.name} · ${rows.length} total`}
        actions={
          <ButtonLink variant="primary" size="lg" href="/studio/new">
            Build one
          </ButtonLink>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing here yet. Build one."
          note="Drop in whatever you already wrote: a CV, an architecture doc, notes on why you left. Ten minutes to something a recruiter can actually interrogate."
          action={
            <ButtonLink variant="primary" href="/studio/new">
              Build one
            </ButtonLink>
          }
        />
      ) : (
        <KBTable rows={rows} />
      )}
    </AppFrame>
  );
}
