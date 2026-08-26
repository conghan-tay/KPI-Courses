"""The Temporal payload contract for course ingestion.

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


class Position(BaseModel):
    """A stance the Specialist will defend against a smart, disagreeing peer.

    `claim` is the hook, `because` is the argument, and `pushback` is the thing a book
    cannot do — it only fires when the Seeker personally objects.

    `quote` is the hallucination canary. POC_UserJourney.md's data model does not list
    it, but the ingestion prompt says "quote-anchor every position to the source text",
    and a position with no verbatim anchor is one the model may have invented. It is
    optional because the verify step clears an anchor it cannot find rather than
    deleting the stance behind it.
    """

    claim: str = Field(min_length=1, max_length=500)
    because: str = Field(default="", max_length=2_000)
    pushback: str = Field(default="", max_length=2_000)
    quote: str = Field(default="", max_length=4_000)


class VoiceCard(BaseModel):
    """What makes the tutor a person rather than ChatGPT with a textbook stapled to it.

    `refuses_to` is in docs/productDocs/fixtures/expected.json but not in the POC sketch;
    it is what the Specialist declines to do, which is different from what they dislike.
    """

    register: str = Field(default="", max_length=2_000)
    pet_peeves: list[str] = Field(default_factory=list)
    signature_moves: list[str] = Field(default_factory=list)
    refuses_to: list[str] = Field(default_factory=list)


class Lesson(BaseModel):
    """One unit of the syllabus.

    `ord` is a display ordinal the gateway reassigns on the way in, so the graph is free
    to leave it at its default; the order of the list is what matters.
    """

    ord: int = Field(default=0, ge=0)
    title: str = Field(min_length=1, max_length=300)
    # A capability ("can size a market from three numbers"), never a topic
    # ("market sizing"). Assertion A1 checks this shape.
    objective: str = Field(default="", max_length=500)
    key_points: list[str] = Field(default_factory=list)
    body_md: str = Field(default="", max_length=100_000)


class IngestRequest(BaseModel):
    """The workflow argument.

    It carries text rather than files: upload handling and PDF extraction live in the
    web app, which keeps raw bytes away from Temporal's payload limit.
    """

    course_id: str = Field(min_length=1, max_length=100)
    specialist_name: str = Field(default="", max_length=200)
    title: str = Field(default="", max_length=300)
    tagline: str = Field(default="", max_length=500)
    source_text: str = Field(min_length=1)
    source_files: list[str] = Field(default_factory=list)


class IngestResult(BaseModel):
    """What the workflow returns. The gateway persists it; the worker has no database."""

    lessons: list[Lesson] = Field(default_factory=list)
    positions: list[Position] = Field(default_factory=list)
    voice_card: VoiceCard = Field(default_factory=VoiceCard)


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


class SoftenRequest(BaseModel):
    claim: str = Field(min_length=1, max_length=500)


class SoftenResult(BaseModel):
    claim: str


# ── the graph's own intermediate types ───────────────────────────────────────
# These never leave the worker. They exist because the pipeline reads each source
# separately before deciding anything, which is what makes the attribution and craft
# traps (fixture assertions A3 and A5) solvable at all.


class SourceKind(StrEnum):
    """What a segment of the corpus is, which decides how much to trust its claims.

    INTERVIEW is the dangerous one: a guest arguing against the author sounds exactly
    like the author being contrarian, and a tutor that defends a guest's position in the
    Specialist's voice is the most expensive failure this system can ship.
    """

    MANUSCRIPT = "manuscript"
    TRANSCRIPT = "transcript"
    INTERVIEW = "interview"
    QA = "qa"
    NEWSLETTER = "newsletter"
    HANDOUT = "handout"
    UNKNOWN = "unknown"


class Segment(BaseModel):
    """One source file from the corpus, before anything has been read out of it."""

    name: str
    text: str


class CandidateClaim(BaseModel):
    """A claim pulled from one segment, before dedup and before the filters run."""

    claim: str = Field(min_length=1, max_length=500)
    quote: str = Field(default="", max_length=4_000)
    # Which source it came from, so `resolve_positions` can weigh a walkback in a later
    # newsletter against a rule stated in an earlier manuscript.
    source_name: str = ""
    source_kind: SourceKind = SourceKind.UNKNOWN
    # False when a guest, critic or questioner said it rather than the author. Kept
    # rather than dropped on the spot: the author's *rebuttal* to a guest is legitimately
    # theirs, and resolving that needs both halves in view.
    by_author: bool = True
    # True when this segment walks back a rule stated earlier. Assertion A4.
    retracts: bool = False
    speaker: str = ""


class SegmentReading(BaseModel):
    """What one pass over one segment produced."""

    kind: SourceKind = SourceKind.UNKNOWN
    summary: str = ""
    candidates: list[CandidateClaim] = Field(default_factory=list)
    # Craft: correct, useful, and uncontested. It belongs in lessons, never in
    # positions. Assertion A5 exists because a corpus of pure hot takes proves nothing.
    craft_points: list[str] = Field(default_factory=list)


class LessonPlan(BaseModel):
    """One planned lesson, before its body has been written."""

    title: str = Field(min_length=1, max_length=300)
    objective: str = Field(default="", max_length=500)
    # Names of the segments this lesson draws on, so the body is written from the right
    # material instead of from the whole corpus again.
    source_names: list[str] = Field(default_factory=list)


class LessonPlanSet(BaseModel):
    lessons: list[LessonPlan] = Field(default_factory=list)


class PositionSet(BaseModel):
    positions: list[Position] = Field(default_factory=list)
