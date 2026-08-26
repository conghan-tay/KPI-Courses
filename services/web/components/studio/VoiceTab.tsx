"use client";

import { Field } from "@/components/form/Field";
import { Textarea } from "@/components/ui/textarea";
import type { VoiceCard } from "@/lib/types";

/**
 * POC_UserJourney.md § "The review screen" — the voice card as editable free
 * text, with one line of guidance.
 *
 * Lists are edited as one line per item. A tag input would be more "designed"
 * and it would also make a Specialist think about data entry instead of about
 * how they sound.
 */
const GUIDANCE = "How do you sound when you're explaining this at a bar?";

function toLines(values: string[]): string {
  return values.join("\n");
}

function fromLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function VoiceTab({
  voice,
  onChange,
}: {
  voice: VoiceCard;
  onChange: (voice: VoiceCard) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <p className="type-body-l measure-read">{GUIDANCE}</p>

      <div className="measure-ui flex flex-col gap-6">
        <Field
          label="Register"
          hint="Sentence rhythm, the analogies you reach for, what you mock."
        >
          {(props) => (
            <Textarea
              {...props}
              rows={4}
              value={voice.register}
              onChange={(event) =>
                onChange({ ...voice, register: event.target.value })
              }
            />
          )}
        </Field>

        <Field label="Pet peeves" hint="One per line.">
          {(props) => (
            <Textarea
              {...props}
              rows={5}
              value={toLines(voice.pet_peeves)}
              onChange={(event) =>
                onChange({ ...voice, pet_peeves: fromLines(event.target.value) })
              }
            />
          )}
        </Field>

        <Field
          label="Signature moves"
          hint="What you always do before you answer. One per line."
        >
          {(props) => (
            <Textarea
              {...props}
              rows={5}
              value={toLines(voice.signature_moves)}
              onChange={(event) =>
                onChange({
                  ...voice,
                  signature_moves: fromLines(event.target.value),
                })
              }
            />
          )}
        </Field>

        <Field
          label="Refuses to"
          hint="What you decline to do — not what annoys you. One per line."
        >
          {(props) => (
            <Textarea
              {...props}
              rows={4}
              value={toLines(voice.refuses_to)}
              onChange={(event) =>
                onChange({ ...voice, refuses_to: fromLines(event.target.value) })
              }
            />
          )}
        </Field>
      </div>
    </div>
  );
}
