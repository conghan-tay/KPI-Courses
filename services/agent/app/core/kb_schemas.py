"""The Temporal payload contract for knowledge-base ingestion.

These models cross the workflow and activity boundaries directly, courtesy of the
pydantic data converter in app/temporal/client.py. The Go gateway mirrors them field for
field in services/gateway/internal/api/types.go, and the browser parses the same field
names against the zod schemas in services/web/lib/types.ts.

Nothing enforces that three-way agreement at build time. Renaming a field here without
renaming it in the other two surfaces as a workflow task failure or a client-side parse
error, never as a compile error — so keep them in step.
"""

from enum import StrEnum

from pydantic import BaseModel, Field

# Exactly four choices, always. The gate renders four and scores one; a question with
# three or five is a rendering bug waiting to happen, so it is a rule rather than a hope.
QUIZ_CHOICE_COUNT = 4


def section_id(path: str, anchor: str) -> str:
    """The id a chip or a quiz item points at: `path`, or `path#anchor`.

    One function rather than string concatenation at eight call sites, because the whole
    reference-resolution check (fixtures/README.md B2) is an equality test on the result,
    and an inconsistent join would silently fail every one of them.
    """

    path = path.strip().strip("#/")
    anchor = anchor.strip().strip("#")
    return f"{path}#{anchor}" if anchor else path


class Section(BaseModel):
    """One addressable piece of the knowledge base.

    This is what the candidate publishes and what the agent speaks from in Journey 2.
    `ord` is a display ordinal the gateway reassigns on the way in, so the graph is free
    to leave it at its default; the order of the list is what matters.
    """

    ord: int = Field(default=0, ge=0)
    # Together these form the id — see section_id(). `path` is a slash-separated topic
    # ("agoda/psp-routing"); `anchor` is optional and names one part of it.
    path: str = Field(min_length=1, max_length=200)
    anchor: str = Field(default="", max_length=100)
    title: str = Field(min_length=1, max_length=300)
    # One or two sentences. Journey 2 puts summaries in the system prompt and fetches
    # bodies on demand, so this has to stand alone.
    summary: str = Field(default="", max_length=1_000)
    body_md: str = Field(default="", max_length=100_000)
    source_names: list[str] = Field(default_factory=list)

    def identifier(self) -> str:
        return section_id(self.path, self.anchor)


class ChipRegister(StrEnum):
    """The three registers chips_example_prompt.txt asks to be mixed.

    Stored rather than inferred, because the mix is checked: eight chips that are all
    skeptical make a worse front page than eight that vary, and only a stored label makes
    that assertable.
    """

    SKEPTICAL = "skeptical"
    NARRATIVE = "narrative"
    BLUNT = "blunt"


class Chip(BaseModel):
    """One opening question a recruiter would actually type first.

    Eight are generated and the candidate picks three for the front page, so `selected`
    lives here — there is nowhere else for it to go.

    `kb_section` is the hallucination canary. It must resolve to a real section id, it is
    verified in code rather than by asking the model again, and one that still does not
    resolve after a repair pass is cleared rather than shipped as a fabricated citation.
    """

    text: str = Field(min_length=1, max_length=200)
    kb_section: str = Field(default="", max_length=300)
    register: ChipRegister = ChipRegister.NARRATIVE
    selected: bool = False
    # The candidate's private reasoning about the chip. Never leaves the owner's copy —
    # see ToPublic in services/gateway/internal/kb/kb.go.
    why_it_lands: str = Field(default="", max_length=1_000)


class QuizCategory(StrEnum):
    """The four categories from quiz_example_prompt.txt, three questions each.

    The gate samples one per category, which is the only reason this is stored: a
    balanced sample is impossible if the category is not on the item.
    """

    MOTIVATION = "motivation"
    JUDGEMENT = "judgement"
    LIMITS = "limits"
    SUBSTANCE = "substance"


class QuizItem(BaseModel):
    """One multiple-choice question from the gate's pool of twelve.

    Not a memory test. The distractors are meant to be what a competent, generic senior
    person in the field WOULD say, so that getting it right means knowing how this
    candidate differs from the median — which is the entire point of the gate.
    """

    id: str = Field(default="", max_length=50)
    category: QuizCategory = QuizCategory.SUBSTANCE
    question: str = Field(min_length=1, max_length=500)
    choices: list[str] = Field(default_factory=list)
    correct_index: int = Field(default=0, ge=0, le=QUIZ_CHOICE_COUNT - 1)
    # Why the answer is right, for the candidate reviewing the quiz. Never shown to a
    # recruiter: the gate reveals which answers were wrong and never which was right.
    rationale: str = Field(default="", max_length=1_000)
    source_section: str = Field(default="", max_length=300)


class PreRoll(BaseModel):
    """What is loaded, shown before the timer starts.

    One headline and four bullets of value proposition, per pre_roll_wireframe.txt. The
    price line is deliberately absent: it is platform-fixed copy, not something a model
    should be inventing per candidate.
    """

    headline: str = Field(default="", max_length=200)
    bullets: list[str] = Field(default_factory=list)


class IngestRequest(BaseModel):
    """The workflow argument.

    It carries text rather than files: upload handling and PDF extraction live in the
    web app, which keeps raw bytes away from Temporal's payload limit.
    """

    kb_id: str = Field(min_length=1, max_length=100)
    candidate_name: str = Field(default="", max_length=200)
    title: str = Field(default="", max_length=300)
    tagline: str = Field(default="", max_length=500)
    source_text: str = Field(min_length=1)
    source_files: list[str] = Field(default_factory=list)


class IngestResult(BaseModel):
    """What the workflow returns. The gateway persists it; the worker has no database."""

    sections: list[Section] = Field(default_factory=list)
    chips: list[Chip] = Field(default_factory=list)
    quiz: list[QuizItem] = Field(default_factory=list)
    pre_roll: PreRoll = Field(default_factory=PreRoll)


class IngestProgressStatus(StrEnum):
    RUNNING = "running"
    READY = "ready"
    FAILED = "failed"


class IngestProgress(BaseModel):
    """The `get_progress` query result.

    Temporal cannot push, so the gateway polls this and forwards the lines it has not
    sent yet. `lines` is append-only and never rewritten: the client tracks how many it
    has seen by count, so reordering or editing a line would replay it.
    """

    status: IngestProgressStatus = IngestProgressStatus.RUNNING
    lines: list[str] = Field(default_factory=list)
    error: str = ""


class RephraseRequest(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    register: ChipRegister = ChipRegister.NARRATIVE


class RephraseResult(BaseModel):
    text: str


# ── the graph's own intermediate types ───────────────────────────────────────
# These never leave the worker. They exist because the pipeline reads each document
# separately before deciding anything, which is what keeps every claim attached to the
# file it came from — and what makes the no-invention rule (fixture assertion B3)
# something the code can enforce rather than something the prompt merely asks for.


class SourceKind(StrEnum):
    """What a document is, which decides how much weight its claims carry.

    NOTES is the loose one. A candidate's private notes are where motivations and stated
    limits live, and they are also where half-formed thoughts live; a knowledge base that
    reports an idle musing as a settled position misrepresents its author.
    """

    RESUME = "resume"
    SYSTEM_WRITEUP = "system_writeup"
    TRANSCRIPT = "transcript"
    REVIEW = "review"
    NOTES = "notes"
    UNKNOWN = "unknown"


class Segment(BaseModel):
    """One source file from the corpus, before anything has been read out of it."""

    name: str
    text: str


class SectionCandidate(BaseModel):
    """A section this document could support, before planning has deduplicated anything.

    Named `SectionCandidate` rather than `Candidate` on purpose: in this domain a
    Candidate is the person whose knowledge base this is.
    """

    title: str = Field(min_length=1, max_length=300)
    # What the reader thinks the id should be. `plan_sections` gets the final say, because
    # it is the first step that sees every document and so the only one that can keep
    # paths consistent across them.
    path_hint: str = Field(default="", max_length=200)
    anchor_hint: str = Field(default="", max_length=100)
    summary: str = Field(default="", max_length=1_000)
    source_name: str = ""
    source_kind: SourceKind = SourceKind.UNKNOWN


class SegmentReading(BaseModel):
    """What one pass over one document produced.

    The four lists after `section_candidates` map onto the quiz's four categories, and
    that is deliberate: a corpus that yields no `stated_limits` cannot produce a `limits`
    question, and it is far better to know that at read time than to find out when the
    generator quietly invents one.
    """

    kind: SourceKind = SourceKind.UNKNOWN
    summary: str = ""
    section_candidates: list[SectionCandidate] = Field(default_factory=list)
    # Verifiable specifics: what was built, at what scale, with which tradeoff.
    facts: list[str] = Field(default_factory=list)
    # Opinions the candidate would defend against a competent, disagreeing peer.
    opinions_held: list[str] = Field(default_factory=list)
    # What they say they are not good at, in their words. Fixture assertion B5.
    stated_limits: list[str] = Field(default_factory=list)
    # Why they left, what they want next, what they would turn down.
    motivations: list[str] = Field(default_factory=list)


class SectionPlan(BaseModel):
    """One planned section, before its body has been written."""

    path: str = Field(min_length=1, max_length=200)
    anchor: str = Field(default="", max_length=100)
    title: str = Field(min_length=1, max_length=300)
    summary: str = Field(default="", max_length=1_000)
    # Names of the documents this section draws on, so the body is written from the right
    # material instead of from the whole corpus again.
    source_names: list[str] = Field(default_factory=list)

    def identifier(self) -> str:
        return section_id(self.path, self.anchor)


class SectionPlanSet(BaseModel):
    sections: list[SectionPlan] = Field(default_factory=list)


class ChipSet(BaseModel):
    chips: list[Chip] = Field(default_factory=list)


class QuizSet(BaseModel):
    quiz: list[QuizItem] = Field(default_factory=list)
