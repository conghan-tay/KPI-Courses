"""The course-ingestion graph.

POC_UserJourney.md sketches Journey 1's ingestion as "a single LLM call, streamed,
~30–60s". This is not that, and the reason is docs/productDocs/fixtures/README.md.

The fixture's traps are not prompt problems, they are attention problems. One pass over
six heterogeneous sources has to hold "who is speaking" (A3), "what was walked back
later" (A4) and "what is merely correct" (A5) in mind at once, and it drops one. Reading
each source alone and resolving afterwards gives every rule a step where it is the only
thing being asked.

Under Temporal that shape pays a second time. Each node is an activity with its own
timeout and retry policy, so a flaky model call on lesson four is retried in isolation
rather than restarting the whole ingestion, and one enormous generation cannot hit a
max-token wall.
"""

from datetime import timedelta
from typing import Any, Literal

import structlog
from langgraph.graph import END, START, StateGraph
from temporalio.common import RetryPolicy

from ..core.course_schemas import (
    CandidateClaim,
    Lesson,
    LessonPlan,
    Position,
    Segment,
    SegmentReading,
    SourceKind,
    VoiceCard,
)
from ..core.ingest_model import IngestionModel
from ..core.safety import inspect_user_text
from ..core.settings import Settings
from . import anchors
from .ingest_state import IngestState
from .progress import NullProgressReporter, ProgressReporter

logger = structlog.get_logger(__name__)

# Every node declares where it runs. "activity" nodes become Temporal activities with
# their own timeout and retry policy, so a flaky model call is retried in isolation
# instead of replaying the whole ingestion. "workflow" nodes run inline in the workflow:
# use that only for cheap, deterministic, side-effect-free work.
LLM_NODE: dict[str, Any] = {
    "execute_in": "activity",
    # Writing a lesson body is the longest single call in the pipeline.
    "start_to_close_timeout": timedelta(seconds=300),
    "retry_policy": RetryPolicy(maximum_attempts=3),
}
WORKFLOW_NODE: dict[str, Any] = {"execute_in": "workflow"}

# The header lib/extract.ts writes between concatenated uploads. Splitting on it is what
# lets the graph read a manuscript and a podcast transcript as separate things, which is
# the whole basis of the attribution rule.
SOURCE_HEADER = "# SOURCE FILE: "


class IngestNodes:
    """The pipeline's steps, bound to their dependencies.

    These are methods rather than closures on purpose. The Temporal LangGraph plugin
    identifies each node by `module.qualname` and rejects closures and lambdas. Binding
    dependencies to an instance keeps them injectable — tests construct this class with
    a fixture model and a null reporter — while giving every node a stable identity.
    """

    def __init__(
        self,
        *,
        settings: Settings,
        model: IngestionModel,
        progress: ProgressReporter | None = None,
    ) -> None:
        self._settings = settings
        self._model = model
        self._progress = progress or NullProgressReporter()

    # ── 1. sanitize ──────────────────────────────────────────────────────────

    async def sanitize(self, state: IngestState) -> dict[str, Any]:
        """Normalise the corpus and flag injection attempts.

        This is somebody else's text, some of it a transcript of a stranger talking, and
        all of it is about to be put in front of a model with instructions. Flags travel
        with the run rather than aborting it: a course is not a threat because one
        sentence in a podcast looked like a prompt.
        """

        result = inspect_user_text(state["source_text"], self._settings.max_source_chars)
        if result.flags:
            logger.warning(
                "ingest_safety_flags",
                course_id=state.get("course_id"),
                flags=list(result.flags),
            )
        return {
            "source_text": result.sanitized_text,
            "safety_flags": list(result.flags),
            "segment_cursor": 0,
            "lesson_cursor": 0,
            "repair_attempts": 0,
            "summaries": [],
            "candidates": [],
            "craft_points": [],
            "lessons": [],
            "status_lines": [],
        }

    # ── 2. segment ───────────────────────────────────────────────────────────

    async def segment(self, state: IngestState) -> dict[str, Any]:
        """Split the corpus back into the files it was concatenated from. Pure."""

        segments = split_corpus(
            state["source_text"],
            state.get("source_files") or [],
            self._settings.max_segment_chars,
        )
        return {"segments": [item.model_dump() for item in segments]}

    # ── 3. read_segment (loops) ──────────────────────────────────────────────

    async def read_segment(self, state: IngestState) -> dict[str, Any]:
        """Read one source on its own, and advance the cursor.

        A self-loop rather than a parallel map: each file gets its own activity, its own
        retry and its own honest status line, and the reads stay ordered so a later
        newsletter can be recognised as walking back an earlier manuscript.
        """

        segments = [Segment.model_validate(row) for row in state["segments"]]
        cursor = state.get("segment_cursor", 0)
        current = segments[cursor]
        total = len(segments)

        line = f"READING {cursor + 1} OF {total} FILES · {current.name}"
        await self._progress.report(line)

        summaries = list(state.get("summaries", []))
        reading = await self._model.read_segment(
            current, state.get("specialist_name", ""), cursor, total, summaries
        )
        reading = _stamp_reading(reading, current.name)

        return {
            "segment_cursor": cursor + 1,
            "summaries": summaries + [reading.summary or current.name],
            "candidates": list(state.get("candidates", []))
            + [candidate.model_dump() for candidate in reading.candidates],
            "craft_points": list(state.get("craft_points", [])) + reading.craft_points,
            "status_lines": list(state.get("status_lines", [])) + [line],
        }

    async def after_read(self, state: IngestState) -> Literal["read_segment", "resolve_positions"]:
        if state.get("segment_cursor", 0) < len(state.get("segments", [])):
            return "read_segment"
        return "resolve_positions"

    # ── 4. resolve_positions ─────────────────────────────────────────────────

    async def resolve_positions(self, state: IngestState) -> dict[str, Any]:
        """Turn candidate claims into the positions the course is sold on.

        The guest filter runs here in code, not only in the prompt. `by_author=false`
        candidates are dropped before the resolver ever sees them, so a model that
        forgets rule 1 cannot produce a tutor that argues a guest's position in the
        Specialist's voice — assertion A3, which the fixture calls the most expensive
        one to ship broken.

        A rebutted guest claim is not lost by doing this: the read step records the
        author's rebuttal as its own candidate, with by_author=true.
        """

        line = "SEPARATING OPINION FROM CRAFT…"
        await self._progress.report(line)

        all_candidates = [CandidateClaim.model_validate(row) for row in state.get("candidates", [])]
        mine = [candidate for candidate in all_candidates if candidate.by_author]
        dropped = len(all_candidates) - len(mine)
        if dropped:
            logger.info(
                "dropped_candidates_by_attribution",
                course_id=state.get("course_id"),
                dropped=dropped,
            )

        status = list(state.get("status_lines", [])) + [line]

        if not mine:
            # A legitimate outcome, not a failure: POC_UserJourney.md says a corpus with
            # no contested claims returns fewer, and never invents them.
            return {"positions": [], "status_lines": status}

        resolved = await self._model.resolve_positions(mine, state.get("specialist_name", ""))
        positions = dedupe_positions(resolved.positions)[: self._settings.max_positions]

        found = f"EXTRACTING POSITIONS · {len(positions)} FOUND"
        await self._progress.report(found)
        return {
            "positions": [position.model_dump() for position in positions],
            "status_lines": status + [found],
        }

    # ── 5. verify_quotes ─────────────────────────────────────────────────────

    async def verify_quotes(self, state: IngestState) -> dict[str, Any]:
        """Assertion A2, run inside the product rather than only in a test. Pure."""

        positions = [Position.model_validate(row) for row in state.get("positions", [])]
        unanchored = anchors.unanchored_indexes(
            [position.quote for position in positions], state["source_text"]
        )
        if unanchored:
            logger.info(
                "unanchored_quotes",
                course_id=state.get("course_id"),
                count=len(unanchored),
                total=len(positions),
            )
        return {"unanchored": unanchored}

    async def after_verify(self, state: IngestState) -> Literal["repair_quotes", "plan_lessons"]:
        if (
            state.get("unanchored")
            and state.get("repair_attempts", 0) < self._settings.max_quote_repairs
        ):
            return "repair_quotes"
        return "plan_lessons"

    # ── 6. repair_quotes ─────────────────────────────────────────────────────

    async def repair_quotes(self, state: IngestState) -> dict[str, Any]:
        """One bounded attempt to find a real anchor for the positions that lack one."""

        line = "CHECKING QUOTE ANCHORS…"
        await self._progress.report(line)

        positions = [Position.model_validate(row) for row in state.get("positions", [])]
        unanchored = list(state.get("unanchored", []))
        broken = [positions[index] for index in unanchored]

        repaired = await self._model.repair_quotes(broken, state["source_text"])
        # Matched by claim rather than by position: the model is asked for quotes, and
        # trusting it to also preserve list order would be one silent reordering away
        # from attaching the wrong evidence to the wrong stance.
        by_claim = {item.claim: item.quote for item in repaired.positions}
        for index in unanchored:
            replacement = by_claim.get(positions[index].claim)
            if replacement:
                positions[index].quote = replacement

        return {
            "positions": [position.model_dump() for position in positions],
            "repair_attempts": state.get("repair_attempts", 0) + 1,
            "status_lines": list(state.get("status_lines", [])) + [line],
        }

    # ── 7. plan_lessons ──────────────────────────────────────────────────────

    async def plan_lessons(self, state: IngestState) -> dict[str, Any]:
        line = "PLANNING THE SYLLABUS…"
        await self._progress.report(line)

        positions = [Position.model_validate(row) for row in state.get("positions", [])]
        planned = await self._model.plan_lessons(
            state.get("specialist_name", ""),
            state.get("title", ""),
            state.get("tagline", ""),
            list(state.get("summaries", [])),
            list(state.get("craft_points", [])),
            [position.claim for position in positions],
        )
        # Capped in code as well as in the prompt: a syllabus of fifteen lessons is one
        # nobody finishes, whatever the model thought.
        plans = planned.lessons[: self._settings.max_lessons]
        return {
            "lesson_plans": [plan.model_dump() for plan in plans],
            "lesson_cursor": 0,
            "lessons": [],
            "status_lines": list(state.get("status_lines", [])) + [line],
        }

    async def after_plan(self, state: IngestState) -> Literal["write_lesson", "read_voice"]:
        return "write_lesson" if state.get("lesson_plans") else "read_voice"

    # ── 8. write_lesson (loops) ──────────────────────────────────────────────

    async def write_lesson(self, state: IngestState) -> dict[str, Any]:
        """Write one lesson body, from the sources its plan named.

        One activity per lesson. That is what makes "WRITING LESSON 4 OF 7" an honest
        status line rather than a guess, what lets lesson four's flaky call retry
        without redoing lessons one to three, and what keeps a seven-lesson course from
        arriving as one generation against a max-token ceiling.
        """

        plans = [LessonPlan.model_validate(row) for row in state["lesson_plans"]]
        cursor = state.get("lesson_cursor", 0)
        plan = plans[cursor]
        total = len(plans)

        line = f"WRITING LESSON {cursor + 1} OF {total} · {plan.title}"
        await self._progress.report(line)

        segments = [Segment.model_validate(row) for row in state.get("segments", [])]
        written = await self._model.write_lesson(
            plan,
            cursor + 1,
            total,
            material_for(plan, segments, self._settings.max_segment_chars),
            "; ".join(state.get("summaries", [])[:2]),
        )
        written.title = written.title or plan.title
        written.objective = written.objective or plan.objective

        return {
            "lesson_cursor": cursor + 1,
            "lessons": list(state.get("lessons", [])) + [written.model_dump()],
            "status_lines": list(state.get("status_lines", [])) + [line],
        }

    async def after_write(self, state: IngestState) -> Literal["write_lesson", "read_voice"]:
        if state.get("lesson_cursor", 0) < len(state.get("lesson_plans", [])):
            return "write_lesson"
        return "read_voice"

    # ── 9. read_voice ────────────────────────────────────────────────────────

    async def read_voice(self, state: IngestState) -> dict[str, Any]:
        line = "READING VOICE…"
        await self._progress.report(line)

        segments = [Segment.model_validate(row) for row in state.get("segments", [])]
        # The opening of each file rather than all of it: register shows up in the first
        # few hundred words, and sending the whole corpus again to learn how somebody
        # sounds is an expensive way to learn nothing extra.
        excerpts = [f"{item.name}\n{item.text[:4_000]}" for item in segments[:6]]
        voice = await self._model.read_voice(state.get("specialist_name", ""), excerpts)
        return {
            "voice_card": voice.model_dump(),
            "status_lines": list(state.get("status_lines", [])) + [line],
        }

    # ── 10. assemble ─────────────────────────────────────────────────────────

    async def assemble(self, state: IngestState) -> dict[str, Any]:
        """Final shape: ordinals, and one last anchor check. Pure.

        The last check matters because repair is bounded. A quote that still is not in
        the source after the repair pass is cleared rather than shipped: the review
        screen renders an unanchored position with a warning, so the Specialist sees
        that this stance has no evidence behind it instead of a fabricated citation.
        The stance itself survives — dropping it would silently lose something the
        author may well believe.
        """

        positions = [Position.model_validate(row) for row in state.get("positions", [])]
        for index in anchors.unanchored_indexes(
            [position.quote for position in positions], state["source_text"]
        ):
            positions[index].quote = ""

        lessons = [Lesson.model_validate(row) for row in state.get("lessons", [])]
        for ordinal, lesson in enumerate(lessons, start=1):
            lesson.ord = ordinal

        if len(lessons) < 5:
            # Not an error: a thin corpus is allowed to produce a thin course, and the
            # review screen lets the Specialist fix it. Worth a log line, because it is
            # also what a truncated model response looks like.
            logger.warning("thin_syllabus", course_id=state.get("course_id"), lessons=len(lessons))
        if len(positions) < anchors.THIN_POSITIONS_THRESHOLD:
            logger.info(
                "thin_positions", course_id=state.get("course_id"), positions=len(positions)
            )

        return {
            "positions": [position.model_dump() for position in positions],
            "lessons": [lesson.model_dump() for lesson in lessons],
            "voice_card": state.get("voice_card") or VoiceCard().model_dump(),
        }


# ── pure helpers, unit-testable without a model ──────────────────────────────


def split_corpus(source_text: str, source_files: list[str], max_chars: int) -> list[Segment]:
    """Recover the individual files from the corpus the web app concatenated.

    joinCorpus in services/web/lib/extract.ts writes "# SOURCE FILE: name" before each
    upload precisely so this is possible. Pasted text arrives without headers and comes
    back as one segment, which is correct: it is one source.
    """

    segments: list[Segment] = []
    if SOURCE_HEADER in source_text:
        for chunk in source_text.split(SOURCE_HEADER):
            if not chunk.strip():
                continue
            name, _, body = chunk.partition("\n")
            text = body.strip().strip("-").strip()
            if text:
                segments.append(Segment(name=name.strip() or "source", text=text[:max_chars]))

    if not segments:
        stripped = source_text.strip()
        if stripped:
            name = source_files[0] if source_files else "pasted text"
            segments.append(Segment(name=name, text=stripped[:max_chars]))
    return segments


def _stamp_reading(reading: SegmentReading, source_name: str) -> SegmentReading:
    """Attribute every candidate to the file it came from.

    The model is asked for `source_name` but has no reason to get it right, and
    `resolve_positions` weighs a walkback in a later newsletter against a rule stated in
    an earlier manuscript. Stamping it here means that provenance is a fact rather than
    something the model remembered.
    """

    for candidate in reading.candidates:
        candidate.source_name = source_name
        if candidate.source_kind is SourceKind.UNKNOWN:
            candidate.source_kind = reading.kind
    return reading


def dedupe_positions(positions: list[Position]) -> list[Position]:
    """Collapse positions that are the same claim written twice.

    A cheap backstop for assertion A6, not a replacement for it. Real dedup is semantic
    — "the price objection isn't about price" restated in a Q&A months later — and that
    judgement belongs to the resolver, which sees every candidate at once. This only
    catches the case where the same sentence survived twice, which is exactly what a
    model does when two sources quote it identically.
    """

    seen: set[str] = set()
    unique: list[Position] = []
    for position in positions:
        key = anchors.normalize_for_match(position.claim)
        if key in seen:
            continue
        seen.add(key)
        unique.append(position)
    return unique


def material_for(plan: LessonPlan, segments: list[Segment], max_chars: int) -> str:
    """The source text one lesson is written from.

    Named sources when the plan named any, everything otherwise. Truncated per segment
    rather than by cutting the tail off the whole string, so a lesson drawing on four
    files still sees the start of all four instead of all of the first and none of the
    last.
    """

    chosen = [item for item in segments if item.name in plan.source_names] or segments
    if not chosen:
        return ""
    budget = max(max_chars // len(chosen), 1_000)
    return "\n\n---\n\n".join(
        f"{SOURCE_HEADER}{item.name}\n\n{item.text[:budget]}" for item in chosen
    )


def build_ingest_graph(nodes: IngestNodes) -> StateGraph:
    """Build the ingestion pipeline.

    Returned uncompiled: the Temporal workflow compiles it with an InMemorySaver, so
    Temporal's event history — not a checkpointer database — owns durability.

    Conditional-edge routers must be `async def`. LangGraph dispatches a *sync* router
    through loop.run_in_executor, which the deterministic workflow event loop does not
    implement.
    """

    builder = StateGraph(IngestState)
    # sanitize, segment, verify and assemble are pure and deterministic, so running them
    # inline costs nothing and saves four activity round trips per run.
    builder.add_node("sanitize", nodes.sanitize, metadata=WORKFLOW_NODE)
    builder.add_node("segment", nodes.segment, metadata=WORKFLOW_NODE)
    builder.add_node("read_segment", nodes.read_segment, metadata=LLM_NODE)
    builder.add_node("resolve_positions", nodes.resolve_positions, metadata=LLM_NODE)
    builder.add_node("verify_quotes", nodes.verify_quotes, metadata=WORKFLOW_NODE)
    builder.add_node("repair_quotes", nodes.repair_quotes, metadata=LLM_NODE)
    builder.add_node("plan_lessons", nodes.plan_lessons, metadata=LLM_NODE)
    builder.add_node("write_lesson", nodes.write_lesson, metadata=LLM_NODE)
    builder.add_node("read_voice", nodes.read_voice, metadata=LLM_NODE)
    builder.add_node("assemble", nodes.assemble, metadata=WORKFLOW_NODE)

    builder.add_edge(START, "sanitize")
    builder.add_edge("sanitize", "segment")
    builder.add_edge("segment", "read_segment")
    builder.add_conditional_edges(
        "read_segment", nodes.after_read, ["read_segment", "resolve_positions"]
    )
    builder.add_edge("resolve_positions", "verify_quotes")
    builder.add_conditional_edges(
        "verify_quotes", nodes.after_verify, ["repair_quotes", "plan_lessons"]
    )
    # Back to the check rather than straight on: a repair that did not find a real
    # anchor must be seen as still unanchored, not assumed fixed.
    builder.add_edge("repair_quotes", "verify_quotes")
    builder.add_conditional_edges("plan_lessons", nodes.after_plan, ["write_lesson", "read_voice"])
    builder.add_conditional_edges("write_lesson", nodes.after_write, ["write_lesson", "read_voice"])
    builder.add_edge("read_voice", "assemble")
    builder.add_edge("assemble", END)
    return builder
