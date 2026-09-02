"use client";

import { Field } from "@/components/form/Field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/riso/Notice";
import { PreRollCard } from "@/components/interview/PreRollCard";
import { Textarea } from "@/components/ui/textarea";
import { PRE_ROLL_BULLETS } from "@/lib/types";
import type { PreRoll } from "@/lib/types";

/**
 * The card a recruiter reads immediately before paying for an hour.
 *
 * Edited on the left, rendered live on the right, because this is the one screen
 * where what you type *is* the artifact — pre_roll_wireframe.txt is drawn for
 * exactly four bullets, and a fifth silently falls off. Seeing it land in the
 * frame is worth more than a character counter.
 *
 * Bullets are one per line. A tag input would be more "designed" and it would
 * also make somebody think about data entry instead of about what they are
 * promising.
 */
const GUIDANCE =
  "Four things you'll actually answer. Name them — a bullet that promises an uncomfortable question is worth two that promise you're impressive.";

function toLines(values: string[]): string {
  return values.join("\n");
}

function fromLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function PreRollTab({
  preRoll,
  onChange,
}: {
  preRoll: PreRoll;
  onChange: (preRoll: PreRoll) => void;
}) {
  const over = preRoll.bullets.length > PRE_ROLL_BULLETS;

  return (
    <div className="flex flex-col gap-6">
      <p className="type-body-l measure-read">{GUIDANCE}</p>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="measure-ui flex flex-col gap-6">
          <Field
            label="Headline"
            hint="One short line. It sets the terms; it doesn't sell."
          >
            {(props) => (
              <Input
                {...props}
                value={preRoll.headline}
                onChange={(event) =>
                  onChange({ ...preRoll, headline: event.target.value })
                }
                placeholder="Sixty minutes. Starts when you hit send."
              />
            )}
          </Field>

          <Field
            label="What's loaded"
            hint={`Exactly ${PRE_ROLL_BULLETS}, one per line. Under about ten words each.`}
          >
            {(props) => (
              <Textarea
                {...props}
                rows={6}
                value={toLines(preRoll.bullets)}
                onChange={(event) =>
                  onChange({ ...preRoll, bullets: fromLines(event.target.value) })
                }
                placeholder={
                  "Full timeline, four employers, gap included\nSix systems I built, at architecture depth"
                }
              />
            )}
          </Field>

          {over && (
            <Notice tone="alert" label="Too many">
              The card holds {PRE_ROLL_BULLETS}. Anything past that is dropped
              when you save.
            </Notice>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <p className="type-label">How it lands</p>
          <PreRollCard
            preRoll={{
              ...preRoll,
              bullets: preRoll.bullets.slice(0, PRE_ROLL_BULLETS),
            }}
            disabled
          />
        </div>
      </div>
    </div>
  );
}
