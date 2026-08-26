"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, ButtonLink } from "@/components/ui/button";
import { Dropzone } from "@/components/studio/Dropzone";
import { Field } from "@/components/form/Field";
import { IngestPanel } from "@/components/studio/IngestPanel";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/riso/Notice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiRequestError, ingestCourse } from "@/lib/api-client";
import { splitFrontmatter } from "@/lib/frontmatter";

// /studio/new — POC_UserJourney.md § Journey 1, steps 1 and 2:
// drop files + title, tagline, price → [Build my course].
//
// Three failure states are built rather than swallowed:
//   · a PDF with no text layer  → "This looks like a scan. Paste the text instead."
//   · invalid meta              → per-field, with the §4.10 invalid treatment
//   · ingestion dies mid-run    → the draft survives and the retry lives on it

type Mode = "editing" | "ingesting" | "failed";

const TEXT_LIKE = /\.(md|markdown|txt|text)$/i;

export function NewCourseForm() {
  const router = useRouter();

  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [tab, setTab] = useState("files");

  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [price, setPrice] = useState("");

  const [mode, setMode] = useState<Mode>("editing");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<{
    message: string;
    courseId?: string;
  } | null>(null);

  // The draft id arrives before ingestion finishes, so a failure still has
  // somewhere to send you.
  const draftId = useRef<string | null>(null);

  async function addFiles(incoming: File[]) {
    setFiles((current) => [...current, ...incoming]);
    setFailure(null);

    // Dropping the fixture (or anything with frontmatter) fills the form in.
    // Only empty fields are touched — never overwrite something typed.
    const first = incoming.find((file) => TEXT_LIKE.test(file.name));
    if (!first) return;

    const { meta } = splitFrontmatter(await first.text());
    if (meta.title) setTitle((value) => value || meta.title);
    if (meta.tagline) setTagline((value) => value || meta.tagline);
    if (meta.price_cents) {
      const dollars = Number(meta.price_cents) / 100;
      if (Number.isFinite(dollars)) {
        setPrice((value) => value || String(dollars));
      }
    }
  }

  async function build() {
    setFieldErrors({});
    setFailure(null);
    setStatuses([]);
    draftId.current = null;

    const body = new FormData();
    body.set("title", title);
    body.set("tagline", tagline);
    body.set("price_cents", String(Math.round(Number(price || 0) * 100)));
    body.set("pasted_text", pasted);
    for (const file of files) body.append("files", file);

    setMode("ingesting");

    try {
      for await (const event of ingestCourse(body)) {
        if (event.type === "draft") {
          draftId.current = event.course_id;
        } else if (event.type === "status") {
          setStatuses((current) => [...current, event.message]);
        } else if (event.type === "result") {
          router.push(`/studio/${event.course_id}`);
          return;
        } else if (event.type === "error") {
          setMode("failed");
          setFailure({ message: event.message, courseId: event.course_id });
          return;
        }
      }
      // The stream ended without a verdict — treat it as a failure rather than
      // leaving the panel spinning forever.
      setMode("failed");
      setFailure({
        message: "The connection dropped before ingestion finished.",
        courseId: draftId.current ?? undefined,
      });
    } catch (error) {
      setMode("editing");

      if (error instanceof ApiRequestError) {
        if (error.detail.fields) {
          setFieldErrors(error.detail.fields);
          return;
        }
        if (error.detail.code === "no_text_layer") {
          // The designed scan state: move them to the tab that will work.
          setTab("paste");
          setFailure({
            message: `${error.detail.file ?? "That PDF"} looks like a scan. Paste the text instead.`,
          });
          return;
        }
        setFailure({ message: error.detail.message });
        return;
      }

      setFailure({
        message:
          error instanceof Error ? error.message : "Ingestion could not start.",
      });
    }
  }

  if (mode === "ingesting") {
    return <IngestPanel statuses={statuses} />;
  }

  if (mode === "failed") {
    return (
      <div className="flex flex-col gap-6">
        <Notice tone="alert" label="Ingestion failed">
          <p>{failure?.message}</p>
          <p className="mt-2 text-ink-muted">
            Your material was saved. Nothing needs re-uploading.
          </p>
        </Notice>
        <div className="flex flex-wrap gap-3">
          {failure?.courseId && (
            <ButtonLink
              variant="accent"
              href={`/studio/${failure.courseId}`}
            >
              Open the draft and retry
            </ButtonLink>
          )}
          <Button variant="secondary" onClick={() => setMode("editing")}>
            Start over
          </Button>
        </div>
      </div>
    );
  }

  const canBuild = files.length > 0 || pasted.trim().length > 0;

  return (
    <div className="flex flex-col gap-8">
      {failure && (
        <Notice label="That file won't work" tone="warning">
          {failure.message}
        </Notice>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="files">Drop files</TabsTrigger>
          <TabsTrigger value="paste">Paste text</TabsTrigger>
        </TabsList>

        <TabsContent value="files" className="pt-6">
          <Dropzone
            files={files}
            onAdd={addFiles}
            onRemove={(index) =>
              setFiles((current) => current.filter((_, i) => i !== index))
            }
          />
        </TabsContent>

        <TabsContent value="paste" className="pt-6">
          <Field
            label="Paste your material"
            hint="A manuscript, transcripts, an AMA thread — whatever you already wrote."
          >
            {(props) => (
              <Textarea
                {...props}
                rows={12}
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                placeholder="Every pricing problem arrives disguised as a pricing problem…"
                className="min-h-64"
              />
            )}
          </Field>
        </TabsContent>
      </Tabs>

      <div className="grid gap-6 md:grid-cols-2">
        <Field label="Course title" error={fieldErrors.title}>
          {(props) => (
            <Input
              {...props}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Hold Your Number"
            />
          )}
        </Field>

        <Field
          label="Price"
          hint="Whole dollars."
          error={fieldErrors.price_cents}
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="349"
            />
          )}
        </Field>

        <Field
          label="Tagline"
          hint="One line, about ten words. It sits under the title everywhere."
          error={fieldErrors.tagline}
          className="md:col-span-2"
        >
          {(props) => (
            <Input
              {...props}
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
              placeholder="The deal is won or lost long before anyone says a price."
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="primary"
          size="lg"
          disabled={!canBuild}
          onClick={build}
        >
          Build my course
        </Button>
        {!canBuild && (
          <span className="type-body-s text-ink-muted">
            Drop a file or paste your material first.
          </span>
        )}
      </div>
    </div>
  );
}
