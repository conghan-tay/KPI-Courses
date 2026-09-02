import { PreRollCard } from "@/components/interview/PreRollCard";
import { PublicChip } from "@/components/kb/ChipCard";
import { RisoPortrait } from "@/components/kb/RisoPortrait";
import { SectionIndex } from "@/components/interview/SectionIndex";
import { Ticker } from "@/components/frame/Ticker";
import { sectionId } from "@/lib/types";
import type { KnowledgeBase } from "@/lib/types";

/**
 * /studio/:id/preview — Journey 1, step 4: "[Preview as a recruiter]".
 *
 * The real /k/:slug furniture — the pre-roll card, the three chosen questions,
 * the index of what's loaded — rendered against the draft's own content. It is
 * deliberately static: the hour is Journey 2, and a fake conversation would tell
 * the candidate something untrue about their knowledge base.
 *
 * It renders the *owner's* copy rather than re-fetching the public projection,
 * so a candidate can preview a draft that has not been published yet. The
 * projection is proved separately, by PublicPreviewPanel on the review screen,
 * which does re-fetch through `?audience=public`.
 */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function RecruiterPreview({
  knowledgeBase,
}: {
  knowledgeBase: KnowledgeBase;
}) {
  const selected = knowledgeBase.chips.filter((chip) => chip.selected);
  const cited = [
    ...knowledgeBase.chips.map((chip) => chip.kb_section),
    ...knowledgeBase.quiz.map((item) => item.source_section),
  ].filter(Boolean);

  return (
    <div className="flex flex-col border-[3px] border-ink">
      <Ticker
        phrases={["Preview — not live"]}
        className="border-b-[3px] border-ink"
      />

      <div className="flex min-h-[520px] max-md:flex-col">
        <SectionIndex
          sections={knowledgeBase.sections}
          citedIds={cited}
          note={`${knowledgeBase.sections.length} sections loaded`}
          className="max-md:w-full max-md:border-r-0 max-md:border-b-[3px]"
          footer={
            <p className="type-body-s text-ink-muted">
              Filled numerals are sections a question points at.
            </p>
          }
        />

        <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
          <div className="flex items-start gap-4">
            <RisoPortrait
              name={knowledgeBase.candidate_name}
              initials={initialsOf(knowledgeBase.candidate_name)}
            />
            <div className="min-w-0">
              <h1 className="type-display-m">{knowledgeBase.title}</h1>
              <p className="type-body-l measure-read mt-2">
                {knowledgeBase.tagline}
              </p>
            </div>
          </div>

          <PreRollCard preRoll={knowledgeBase.pre_roll} disabled />

          <div className="flex flex-col gap-3">
            <p className="type-meta text-ink-muted">
              Or start with one of these
            </p>
            {selected.length === 0 ? (
              <p className="type-body-s text-ink-muted">
                No questions chosen yet. Pick three on the Questions tab — they
                are the first thing a recruiter sees.
              </p>
            ) : (
              <div className="flex flex-col items-start gap-2">
                {selected.map((chip, index) => (
                  <PublicChip key={index} text={chip.text} />
                ))}
              </div>
            )}
          </div>

          {/* Named so the candidate can see the id a question resolves to — it
              is the thing the whole reference check turns on. */}
          {knowledgeBase.sections.length > 0 && (
            <details className="border-2 border-ink">
              <summary className="type-meta cursor-pointer px-3 py-2 hover:bg-pink">
                ▸ Section ids
              </summary>
              <ul className="flex flex-col gap-1 border-t-2 border-ink bg-paper-tint px-3 py-3">
                {knowledgeBase.sections.map((section) => (
                  <li key={section.ord} className="font-mono text-[13px]">
                    {sectionId(section.path, section.anchor)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
