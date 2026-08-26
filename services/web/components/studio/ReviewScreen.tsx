"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button, ButtonLink } from "@/components/ui/button";
import { IngestPanel } from "@/components/studio/IngestPanel";
import { Notice } from "@/components/riso/Notice";
import { PositionsTab } from "@/components/studio/PositionsTab";
import { PublicPreviewPanel } from "@/components/studio/PublicPreviewPanel";
import { PublishDialog } from "@/components/studio/PublishDialog";
import { SyllabusTab } from "@/components/studio/SyllabusTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VoiceTab } from "@/components/studio/VoiceTab";
import { useCourseDraft } from "@/components/studio/useCourseDraft";
import { ApiRequestError, publishCourse, reingestCourse } from "@/lib/api-client";
import { isThinOnPositions } from "@/lib/quotes";
import { formatPrice } from "@/lib/text";
import type { Course } from "@/lib/types";

// /studio/:id — the review screen, and the one that matters.
//
// It defaults to Positions, not Syllabus. That is the reframe: it tells the
// Specialist their opinions are the asset. When the material didn't yield many
// stances it defaults to Syllabus instead and reframes around where students
// get stuck, rather than showing someone a screen implying they're boring.

const SAVE_LABEL = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved — check your connection",
} as const;

export function ReviewScreen({
  initialCourse,
  unanchoredClaims,
}: {
  initialCourse: Course;
  unanchoredClaims: string[];
}) {
  const router = useRouter();
  const { course, saveState, apply, flush, replace } =
    useCourseDraft(initialCourse);

  const thin = isThinOnPositions(course.positions);
  const [tab, setTab] = useState(thin ? "syllabus" : "positions");

  const [publishUrl, setPublishUrl] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string[] | null>(null);
  const [retryStatuses, setRetryStatuses] = useState<string[] | null>(null);

  async function publish() {
    setPublishError(null);
    await flush();
    try {
      const { course: published, url } = await publishCourse(course.id);
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
    for await (const event of reingestCourse(course.id)) {
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

  if (course.ingest_status === "failed") {
    return (
      <div className="flex flex-col gap-6">
        <Header course={course} saveLabel="" />
        <Notice
          tone="alert"
          label="Ingestion failed"
          actions={
            <Button variant="accent" onClick={() => void retryIngestion()}>
              Retry ingestion
            </Button>
          }
        >
          <p>{course.ingest_error ?? "The model didn't finish."}</p>
          <p className="mt-2 text-ink-muted">
            Your material is saved — {course.source_files.join(", ") || "pasted text"}.
            Nothing needs re-uploading.
          </p>
        </Notice>
      </div>
    );
  }

  if (course.ingest_status === "running") {
    return (
      <div className="flex flex-col gap-6">
        <Header course={course} saveLabel="" />
        <Notice
          label="Still building"
          actions={
            <Button variant="secondary" onClick={() => router.refresh()}>
              Check again
            </Button>
          }
        >
          This course is still being built. It usually takes under a minute.
        </Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Header
        course={course}
        saveLabel={SAVE_LABEL[saveState]}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={async () => {
                await flush();
                router.push(`/studio/${course.id}/preview`);
              }}
            >
              Preview as a student
            </Button>
            <Button variant="accent" onClick={() => void publish()}>
              {course.status === "published" ? "Republish" : "Publish"}
            </Button>
          </>
        }
      />

      {publishError && (
        <Notice tone="alert" label="Can't publish yet">
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {publishError.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Notice>
      )}

      <p className="type-body-l measure-read">
        {thin
          ? "Your material is mostly craft, not argument — so this course sells on the syllabus. Start there."
          : "Your opinions are the asset. Start with the stances; the syllabus is the easy part."}
      </p>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Tabs
            value={tab}
            onValueChange={(next) => {
              // Never let a debounced edit sit unsaved behind a tab switch.
              void flush();
              setTab(next);
            }}
          >
            <TabsList>
              <TabsTrigger value="positions">
                Positions · {course.positions.length}
              </TabsTrigger>
              <TabsTrigger value="syllabus">
                Syllabus · {course.lessons.length}
              </TabsTrigger>
              <TabsTrigger value="voice">Voice</TabsTrigger>
            </TabsList>

            <div className="border-2 border-t-0 border-ink p-6">
              <TabsContent value="positions">
                <PositionsTab
                  course={course}
                  unanchoredClaims={unanchoredClaims}
                  onChange={(positions) => apply({ positions })}
                  onReplaceCourse={replace}
                />
              </TabsContent>

              <TabsContent value="syllabus">
                <SyllabusTab
                  lessons={course.lessons}
                  onChange={(lessons) => apply({ lessons })}
                />
              </TabsContent>

              <TabsContent value="voice">
                <VoiceTab
                  voice={course.voice_card}
                  onChange={(voice_card) => apply({ voice_card })}
                />
              </TabsContent>
            </div>
          </Tabs>
        </div>

        {/* `updated_at` changes exactly when a save lands, so the preview
            follows the edits without a counter to keep in sync. */}
        <PublicPreviewPanel
          courseId={course.id}
          refreshKey={course.updated_at}
        />
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
  course,
  saveLabel,
  actions,
}: {
  course: Course;
  saveLabel: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b-[3px] border-ink pb-4">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="type-meta border-2 border-ink px-2 py-0.5">
            {course.status === "published" ? "Published" : "Draft"}
          </span>
          <span className="type-meta border-2 border-ink bg-pink px-2 py-0.5">
            {formatPrice(course.price_cents)}
          </span>
          {saveLabel && (
            <span className="type-meta text-ink-muted" aria-live="polite">
              {saveLabel}
            </span>
          )}
        </div>
        <h1 className="type-display-l mt-3">{course.title}</h1>
        <p className="type-body-s mt-2 text-ink-muted">{course.tagline}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ButtonLink variant="ghost" href="/studio">
          All courses
        </ButtonLink>
        {actions}
      </div>
    </div>
  );
}
