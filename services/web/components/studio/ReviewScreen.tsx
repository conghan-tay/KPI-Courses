"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, ButtonLink } from "@/components/ui/button";
import { ChipsTab } from "@/components/studio/ChipsTab";
import { IngestPanel } from "@/components/studio/IngestPanel";
import { Notice } from "@/components/chrome/Notice";
import { PreRollTab } from "@/components/studio/PreRollTab";
import { PublicPreviewPanel } from "@/components/studio/PublicPreviewPanel";
import { PublishDialog } from "@/components/studio/PublishDialog";
import { QuizTab } from "@/components/studio/QuizTab";
import { SectionsTab } from "@/components/studio/SectionsTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useKBDraft } from "@/components/studio/useKBDraft";
import {
  ApiRequestError,
  publishKnowledgeBase,
  reingestKnowledgeBase,
} from "@/lib/api-client";
import { auditRefs } from "@/lib/refs";
import { SELECTED_CHIP_COUNT } from "@/lib/types";
import type { KnowledgeBase } from "@/lib/types";

// /studio/:id — the review screen, and the one that matters.
//
// It defaults to Questions, not the knowledge base. That is the reframe: eight
// openers were generated and the candidate is choosing which three represent
// them. It is the decision they will actually want to make, and the one that
// decides what a stranger sees.

const SAVE_LABEL = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved. Check your connection.",
} as const;

export function ReviewScreen({ initial }: { initial: KnowledgeBase }) {
  const router = useRouter();
  const { knowledgeBase, saveState, apply, flush, replace } = useKBDraft(initial);

  // Recomputed on every edit rather than passed in from the server: deleting a
  // section is how a candidate orphans three questions, and the warning has to
  // appear the moment they do it, not on the next page load.
  const refs = useMemo(
    () =>
      auditRefs(
        knowledgeBase.sections,
        knowledgeBase.chips,
        knowledgeBase.quiz
      ),
    [knowledgeBase.sections, knowledgeBase.chips, knowledgeBase.quiz]
  );
  const citedIds = useMemo(
    () =>
      new Set(
        [
          ...knowledgeBase.chips.map((chip) => chip.kb_section),
          ...knowledgeBase.quiz.map((item) => item.source_section),
        ].filter(Boolean)
      ),
    [knowledgeBase.chips, knowledgeBase.quiz]
  );

  const [tab, setTab] = useState("chips");
  const [publishUrl, setPublishUrl] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string[] | null>(null);
  const [retryStatuses, setRetryStatuses] = useState<string[] | null>(null);

  const selected = knowledgeBase.chips.filter((chip) => chip.selected).length;

  async function publish() {
    setPublishError(null);
    await flush();
    try {
      const { knowledge_base: published, url } = await publishKnowledgeBase(
        knowledgeBase.id
      );
      replace(published);
      setPublishUrl(url);
    } catch (error) {
      setPublishError(
        error instanceof ApiRequestError
          ? (error.detail.blockers ?? [error.detail.message])
          : ["Publishing failed."]
      );
    }
  }

  async function retryIngestion() {
    setRetryStatuses([]);
    for await (const event of reingestKnowledgeBase(knowledgeBase.id)) {
      if (event.type === "status") {
        setRetryStatuses((current) => [...(current ?? []), event.message]);
      } else if (event.type === "result") {
        router.refresh();
        return;
      } else if (event.type === "error") {
        setRetryStatuses(null);
        return;
      }
    }
  }

  if (retryStatuses) {
    return <IngestPanel statuses={retryStatuses} />;
  }

  if (knowledgeBase.ingest_status === "failed") {
    return (
      <div className="flex flex-col gap-6">
        <Header knowledgeBase={knowledgeBase} saveLabel="" />
        <Notice
          tone="danger"
          label="Ingestion failed"
          actions={
            <Button variant="primary" onClick={() => void retryIngestion()}>
              Retry
            </Button>
          }
        >
          <p>{knowledgeBase.ingest_error ?? "The pipeline didn't finish."}</p>
          <p className="mt-2 text-ink-muted">
            Your documents are saved:{" "}
            {knowledgeBase.source_files.join(", ") || "pasted text"}. Nothing
            needs re-uploading.
          </p>
        </Notice>
      </div>
    );
  }

  if (knowledgeBase.ingest_status === "running") {
    return (
      <div className="flex flex-col gap-6">
        <Header knowledgeBase={knowledgeBase} saveLabel="" />
        <Notice
          label="Still building"
          actions={
            <Button variant="secondary" onClick={() => router.refresh()}>
              Check again
            </Button>
          }
        >
          This is still being built. It usually takes a minute or two.
        </Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Header
        knowledgeBase={knowledgeBase}
        saveLabel={SAVE_LABEL[saveState]}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={async () => {
                await flush();
                router.push(`/studio/${knowledgeBase.id}/preview`);
              }}
            >
              Preview as a recruiter
            </Button>
            <Button variant="live" onClick={() => void publish()}>
              {knowledgeBase.status === "published" ? "Republish" : "Publish"}
            </Button>
          </>
        }
      />

      {publishError && (
        <Notice tone="danger" label="Can't publish yet">
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {publishError.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Notice>
      )}

      <p className="type-body-lg measure-read text-ink-muted">
        Eight questions a recruiter would type first. Pick the {SELECTED_CHIP_COUNT}{" "}
        that go on your front page. The rest of this is what answers them.
      </p>

      {/* NEW_DESIGN.md §5 — the editor takes the width; the preview is a fixed
          320px reference beside it, not a third of the grid. Below `xl` it is
          hidden outright rather than squeezing the thing being edited. */}
      <div className="flex items-start gap-8 max-xl:block">
        <div className="min-w-0 flex-1">
          <Tabs
            value={tab}
            onValueChange={(next) => {
              // Never let a debounced edit sit unsaved behind a tab switch.
              void flush();
              setTab(next);
            }}
          >
            <TabsList>
              <TabsTrigger value="chips">
                Questions · {selected}/{SELECTED_CHIP_COUNT}
              </TabsTrigger>
              <TabsTrigger value="sections">
                Knowledge base · {knowledgeBase.sections.length}
              </TabsTrigger>
              <TabsTrigger value="quiz">
                Quiz · {knowledgeBase.quiz.length}
              </TabsTrigger>
              <TabsTrigger value="pre-roll">Pre-roll</TabsTrigger>
            </TabsList>

            <div className="mt-6 rounded-xl border border-hairline bg-surface p-6 max-md:p-4">
              <TabsContent value="chips">
                <ChipsTab
                  knowledgeBase={knowledgeBase}
                  unresolved={refs.chips}
                  onChange={(chips) => apply({ chips })}
                  onReplace={replace}
                />
              </TabsContent>

              <TabsContent value="sections">
                <SectionsTab
                  sections={knowledgeBase.sections}
                  citedIds={citedIds}
                  onChange={(sections) => apply({ sections })}
                />
              </TabsContent>

              <TabsContent value="quiz">
                <QuizTab
                  quiz={knowledgeBase.quiz}
                  unresolved={refs.quiz}
                  onChange={(quiz) => apply({ quiz })}
                />
              </TabsContent>

              <TabsContent value="pre-roll">
                <PreRollTab
                  preRoll={knowledgeBase.pre_roll}
                  onChange={(pre_roll) => apply({ pre_roll })}
                />
              </TabsContent>
            </div>
          </Tabs>
        </div>

        {/* `updated_at` changes exactly when a save lands, so the preview
            follows the edits without a counter to keep in sync. */}
        <aside className="w-80 shrink-0 max-xl:hidden">
          <PublicPreviewPanel
            kbId={knowledgeBase.id}
            refreshKey={knowledgeBase.updated_at}
          />
        </aside>
      </div>

      <PublishDialog
        open={publishUrl !== null}
        url={publishUrl}
        onOpenChange={(open) => !open && setPublishUrl(null)}
      />
    </div>
  );
}

function Header({
  knowledgeBase,
  saveLabel,
  actions,
}: {
  knowledgeBase: KnowledgeBase;
  saveLabel: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="type-caption rounded-xs bg-surface-sunk px-2 py-1 text-ink-muted">
            {knowledgeBase.status === "published" ? "Published" : "Draft"}
          </span>
          <span className="type-mono rounded-xs bg-surface-sunk px-2 py-0.5 text-ink-muted">
            /k/{knowledgeBase.slug}
          </span>
          {saveLabel && (
            <span className="type-caption text-ink-subtle" aria-live="polite">
              {saveLabel}
            </span>
          )}
        </div>
        <h1 className="type-display mt-3">{knowledgeBase.title}</h1>
        <p className="type-body mt-1.5 text-ink-muted">{knowledgeBase.tagline}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ButtonLink variant="ghost" href="/studio">
          All knowledge bases
        </ButtonLink>
        {actions}
      </div>
    </div>
  );
}
