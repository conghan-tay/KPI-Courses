"""The knowledge-base ingestion graph.

Not one model call, and the reason is docs/productDocs/fixtures/README.md.

The fixture's traps are not prompt problems, they are attention problems. One pass over
seven heterogeneous documents has to hold "record scope exactly as stated" (B3), "the gap
stays in" (B4) and "the stated limits are not caveats, they are the point" (B5) in mind
at once, and it drops one. Reading each document alone and deciding afterwards gives
every rule a step where it is the only thing being asked.

The order also encodes a hard dependency the tutoring pipeline this replaces did not
have: **chips and quiz items cite sections by id, so the sections must exist first.**
Section planning and writing therefore run ahead of both, and the reference check that
follows is an equality test rather than a hope.

Under Temporal that shape pays a second time. Each node is an activity with its own
timeout and retry policy, so a flaky model call on section nine is retried in isolation
rather than restarting the whole ingestion, and one enormous generation cannot hit a
max-token wall.
"""

from datetime import timedelta
from typing import Any, Literal

import structlog
from langgraph.graph import END, START, StateGraph
from temporalio.common import RetryPolicy

from ..core.ingest_model import IngestionModel
from ..core.kb_schemas import (
    QUIZ_CHOICE_COUNT,
    Chip,
    PreRoll,
    QuizCategory,
    QuizItem,
    Section,
    SectionPlan,
    Segment,
    SegmentReading,
    section_id,
)
from ..core.safety import inspect_user_text
from ..core.settings import Settings
from . import refs
from .ingest_state import IngestState
from .progress import NullProgressReporter, ProgressReporter

logger = structlog.get_logger(__name__)

# Every node declares where it runs. "activity" nodes become Temporal activities with
# their own timeout and retry policy, so a flaky model call is retried in isolation
# instead of replaying the whole ingestion. "workflow" nodes run inline in the workflow:
# use that only for cheap, deterministic, side-effect-free work.
LLM_NODE: dict[str, Any] = {
    "execute_in": "activity",
    # Writing a section body is the longest single call in the pipeline.
    "start_to_close_timeout": timedelta(seconds=300),
    "retry_policy": RetryPolicy(maximum_attempts=3),
}
WORKFLOW_NODE: dict[str, Any] = {"execute_in": "workflow"}

# The header lib/extract.ts writes between concatenated uploads. Splitting on it is what
# lets the graph read a CV and an architecture write-up as separate things, which is the
# whole basis of reading each document on its own.
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

        This is a person's own material, some of it written by other people about them,
        and all of it is about to be put in front of a model with instructions. Flags
        travel with the run rather than aborting it: a knowledge base is not a threat
        because one sentence in a performance review looked like a prompt.
        """

        result = inspect_user_text(state["source_text"], self._settings.max_source_chars)
        if result.flags:
            logger.warning(
                "ingest_safety_flags",
                kb_id=state.get("kb_id"),
                flags=list(result.flags),
            )
        return {
            "source_text": result.sanitized_text,
            "safety_flags": list(result.flags),
            "segment_cursor": 0,
            "section_cursor": 0,
            "repair_attempts": 0,
            "summaries": [],
            "section_candidates": [],
            "facts": [],
            "opinions": [],
            "limits": [],
            "motivations": [],
            "sections": [],
            "chips": [],
            "quiz": [],
            "status_lines": [],
        }

    # ── 2. segment ───────────────────────────────────────────────────────────

    async def segment(self, state: IngestState) -> dict[str, Any]:
        """Split the corpus back into the documents it was concatenated from. Pure."""

        segments = split_corpus(
            state["source_text"],
            state.get("source_files") or [],
            self._settings.max_segment_chars,
        )
        return {"segments": [item.model_dump() for item in segments]}

    async def after_segment(self, state: IngestState) -> Literal["read_segment", "generate_chips"]:
        """Skip the whole reading phase when there is nothing to read.

        `split_corpus` returns nothing for a corpus that is only whitespace, and
        `read_segment` would index into an empty list. The gateway rejects a source text
        under 200 trimmed characters, so this is unreachable through the product — but a
        graph that only holds because of a check two services away is one refactor from
        an IndexError that Temporal retries three times before failing the run, turning
        an empty upload into a crashed pipeline.

        Straight to `generate_chips` rather than through `plan_sections`, for the same
        reason `after_plan` skips the write loop: planning from nothing is a model call
        whose only possible output is invention.
        """

        return "read_segment" if state.get("segments") else "generate_chips"

    # ── 3. read_segment (loops) ──────────────────────────────────────────────

    async def read_segment(self, state: IngestState) -> dict[str, Any]:
        """Read one document on its own, and advance the cursor.

        A self-loop rather than a parallel map: each document gets its own activity, its
        own retry and its own honest status line, and the reads stay ordered so a later
        document can be recognised as covering ground an earlier one already did.
        """

        segments = [Segment.model_validate(row) for row in state["segments"]]
        cursor = state.get("segment_cursor", 0)
        current = segments[cursor]
        total = len(segments)

        line = f"READING {cursor + 1} OF {total} FILES · {current.name}"
        await self._progress.report(line)

        summaries = list(state.get("summaries", []))
        reading = await self._model.read_segment(
            current, state.get("candidate_name", ""), cursor, total, summaries
        )
        reading = _stamp_reading(reading, current.name)

        return {
            "segment_cursor": cursor + 1,
            "summaries": summaries + [reading.summary or current.name],
            "section_candidates": list(state.get("section_candidates", []))
            + [candidate.model_dump() for candidate in reading.section_candidates],
            "facts": list(state.get("facts", [])) + reading.facts,
            "opinions": list(state.get("opinions", [])) + reading.opinions_held,
            "limits": list(state.get("limits", [])) + reading.stated_limits,
            "motivations": list(state.get("motivations", [])) + reading.motivations,
            "status_lines": list(state.get("status_lines", [])) + [line],
        }

    async def after_read(self, state: IngestState) -> Literal["read_segment", "plan_sections"]:
        if state.get("segment_cursor", 0) < len(state.get("segments", [])):
            return "read_segment"
        return "plan_sections"

    # ── 4. plan_sections ─────────────────────────────────────────────────────

    async def plan_sections(self, state: IngestState) -> dict[str, Any]:
        """Decide the shape of the knowledge base before writing any of it."""

        line = "PLANNING THE KNOWLEDGE BASE…"
        await self._progress.report(line)

        planned = await self._model.plan_sections(
            state.get("candidate_name", ""),
            state.get("title", ""),
            state.get("tagline", ""),
            list(state.get("summaries", [])),
            list(state.get("section_candidates", [])),
            list(state.get("facts", [])),
            list(state.get("opinions", [])),
            list(state.get("limits", [])),
            list(state.get("motivations", [])),
        )
        # Deduplicated and capped in code as well as in the prompt. Two sections sharing
        # an id would make every reference to it a coin flip, and a forty-section
        # knowledge base is one nobody reads, whatever the model thought.
        plans = dedupe_plans(planned.sections)[: self._settings.max_sections]
        return {
            "section_plans": [plan.model_dump() for plan in plans],
            "section_cursor": 0,
            "sections": [],
            "status_lines": list(state.get("status_lines", [])) + [line],
        }

    async def after_plan(self, state: IngestState) -> Literal["write_section", "generate_chips"]:
        return "write_section" if state.get("section_plans") else "generate_chips"

    # ── 5. write_section (loops) ─────────────────────────────────────────────

    async def write_section(self, state: IngestState) -> dict[str, Any]:
        """Write one section body, from the documents its plan named.

        One activity per section. That is what makes "WRITING SECTION 4 OF 14" an honest
        status line rather than a guess, what lets section four's flaky call retry
        without redoing one to three, and what keeps a fourteen-section knowledge base
        from arriving as one generation against a max-token ceiling.
        """

        plans = [SectionPlan.model_validate(row) for row in state["section_plans"]]
        cursor = state.get("section_cursor", 0)
        plan = plans[cursor]
        total = len(plans)

        line = f"WRITING SECTION {cursor + 1} OF {total} · {plan.title}"
        await self._progress.report(line)

        segments = [Segment.model_validate(row) for row in state.get("segments", [])]
        written = await self._model.write_section(
            plan,
            cursor + 1,
            total,
            material_for(plan, segments, self._settings.max_segment_chars),
        )
        # The plan owns the id and the title. A writer that renames its own section
        # invalidates every chip and quiz item that was about to cite it.
        written.path = plan.path
        written.anchor = plan.anchor
        written.title = written.title or plan.title
        written.summary = written.summary or plan.summary
        written.source_names = plan.source_names

        return {
            "section_cursor": cursor + 1,
            "sections": list(state.get("sections", [])) + [written.model_dump()],
            "status_lines": list(state.get("status_lines", [])) + [line],
        }

    async def after_write(self, state: IngestState) -> Literal["write_section", "generate_chips"]:
        if state.get("section_cursor", 0) < len(state.get("section_plans", [])):
            return "write_section"
        return "generate_chips"

    # ── 6. generate_chips ────────────────────────────────────────────────────

    async def generate_chips(self, state: IngestState) -> dict[str, Any]:
        """Eight questions a recruiter would type first, three of them pre-selected.

        The selection is made here rather than left to the candidate's first visit,
        because a review screen that opens with nothing chosen and a publish button that
        refuses to work is a worse first impression than three sensible defaults they
        can change.
        """

        line = "DRAFTING OPENING QUESTIONS…"
        await self._progress.report(line)

        sections = _section_digest(state)
        if not sections:
            return {"chips": [], "status_lines": list(state.get("status_lines", [])) + [line]}

        generated = await self._model.generate_chips(state.get("candidate_name", ""), sections)
        chips = generated.chips[: self._settings.max_chips]
        chips = select_default_chips(chips, refs.SELECTED_CHIPS)

        found = f"DRAFTING OPENING QUESTIONS · {len(chips)} FOUND"
        await self._progress.report(found)
        return {
            "chips": [chip.model_dump() for chip in chips],
            "status_lines": list(state.get("status_lines", [])) + [line, found],
        }

    # ── 7. generate_quiz ─────────────────────────────────────────────────────

    async def generate_quiz(self, state: IngestState) -> dict[str, Any]:
        """Twelve questions, three per category, for the booking gate.

        Malformed items are dropped in code rather than only discouraged in the prompt:
        the gate renders exactly four options and scores one of them, so an item with
        three choices or an out-of-range answer is not a weak question, it is a broken
        screen.
        """

        line = "WRITING THE GATE QUIZ…"
        await self._progress.report(line)

        sections = _section_digest(state)
        if not sections:
            return {"quiz": [], "status_lines": list(state.get("status_lines", [])) + [line]}

        generated = await self._model.generate_quiz(
            state.get("candidate_name", ""),
            sections,
            list(state.get("limits", [])),
            list(state.get("motivations", [])),
        )
        quiz = usable_quiz_items(generated.quiz)[: self._settings.max_quiz_items]
        quiz = number_quiz_items(quiz)

        dropped = len(generated.quiz) - len(quiz)
        if dropped > 0:
            logger.info("dropped_malformed_quiz_items", kb_id=state.get("kb_id"), dropped=dropped)

        written = f"WRITING THE GATE QUIZ · {len(quiz)} QUESTIONS"
        await self._progress.report(written)
        return {
            "quiz": [item.model_dump() for item in quiz],
            "status_lines": list(state.get("status_lines", [])) + [line, written],
        }

    # ── 8. verify_refs ───────────────────────────────────────────────────────

    async def verify_refs(self, state: IngestState) -> dict[str, Any]:
        """Assertion B2, run inside the product rather than only in a test. Pure."""

        ids = _section_ids(state)
        chips = [Chip.model_validate(row) for row in state.get("chips", [])]
        quiz = [QuizItem.model_validate(row) for row in state.get("quiz", [])]

        unresolved_chips = refs.unresolved_indexes([chip.kb_section for chip in chips], ids)
        unresolved_quiz = refs.unresolved_indexes([item.source_section for item in quiz], ids)

        if unresolved_chips or unresolved_quiz:
            logger.info(
                "unresolved_section_refs",
                kb_id=state.get("kb_id"),
                chips=len(unresolved_chips),
                quiz=len(unresolved_quiz),
                sections=len(ids),
            )
        return {"unresolved_chips": unresolved_chips, "unresolved_quiz": unresolved_quiz}

    async def after_verify(self, state: IngestState) -> Literal["repair_refs", "write_pre_roll"]:
        unresolved = state.get("unresolved_chips") or state.get("unresolved_quiz")
        if unresolved and state.get("repair_attempts", 0) < self._settings.max_ref_repairs:
            return "repair_refs"
        return "write_pre_roll"

    # ── 9. repair_refs ───────────────────────────────────────────────────────

    async def repair_refs(self, state: IngestState) -> dict[str, Any]:
        """One bounded attempt to find a real section for the items that cite nothing."""

        line = "CHECKING SECTION REFERENCES…"
        await self._progress.report(line)

        ids = _section_ids(state)
        chips = [Chip.model_validate(row) for row in state.get("chips", [])]
        quiz = [QuizItem.model_validate(row) for row in state.get("quiz", [])]
        broken_chips = list(state.get("unresolved_chips", []))
        broken_quiz = list(state.get("unresolved_quiz", []))

        # Both lists in one call: they are the same question over the same section ids,
        # and one round trip is cheaper than two.
        asked = [chips[index].text for index in broken_chips] + [
            quiz[index].question for index in broken_quiz
        ]
        repaired = await self._model.repair_refs(asked, ids)
        # Padded rather than indexed defensively at each use: a model that returns a
        # short list is a model that answered some of them, and the rest stay unresolved.
        repaired += [""] * (len(asked) - len(repaired))

        for offset, index in enumerate(broken_chips):
            # `resolve` returns the canonical id, so a model that found the right section
            # with the wrong casing is written back correctly rather than failing again.
            if canonical := refs.resolve(repaired[offset], ids):
                chips[index].kb_section = canonical
        for offset, index in enumerate(broken_quiz):
            if canonical := refs.resolve(repaired[len(broken_chips) + offset], ids):
                quiz[index].source_section = canonical

        return {
            "chips": [chip.model_dump() for chip in chips],
            "quiz": [item.model_dump() for item in quiz],
            "repair_attempts": state.get("repair_attempts", 0) + 1,
            "status_lines": list(state.get("status_lines", [])) + [line],
        }

    # ── 10. write_pre_roll ───────────────────────────────────────────────────

    async def write_pre_roll(self, state: IngestState) -> dict[str, Any]:
        line = "WRITING THE PRE-ROLL…"
        await self._progress.report(line)

        # Section titles and summaries rather than bodies: the pre-roll says what is
        # loaded, and sending fourteen full bodies to write four bullets is an expensive
        # way to learn nothing extra.
        pre_roll = await self._model.write_pre_roll(
            state.get("candidate_name", ""), _section_digest(state, with_body=False)
        )
        pre_roll.bullets = pre_roll.bullets[: self._settings.pre_roll_bullets]
        return {
            "pre_roll": pre_roll.model_dump(),
            "status_lines": list(state.get("status_lines", [])) + [line],
        }

    # ── 11. assemble ─────────────────────────────────────────────────────────

    async def assemble(self, state: IngestState) -> dict[str, Any]:
        """Final shape: ordinals, canonical references, and the thin-result log. Pure.

        Every reference is rewritten to the exact section id it resolves to, or cleared.
        Two things fall out of that, and both matter downstream:

        - What is stored is byte-identical to a section id, so Journey 2 can look a
          citation up with an equality check instead of re-implementing this module's
          normalisation in a third language.
        - A reference that still resolves to nothing after a bounded repair is cleared
          rather than shipped: the review screen renders the card as unsourced, so the
          candidate sees that this question has nothing behind it instead of a citation
          that leads nowhere. The chip or question itself survives — deleting it would
          silently lose something worth asking.
        """

        ids = _section_ids(state)

        chips = [Chip.model_validate(row) for row in state.get("chips", [])]
        for chip in chips:
            chip.kb_section = refs.resolve(chip.kb_section, ids) or ""

        quiz = [QuizItem.model_validate(row) for row in state.get("quiz", [])]
        for item in quiz:
            item.source_section = refs.resolve(item.source_section, ids) or ""

        sections = [Section.model_validate(row) for row in state.get("sections", [])]
        for ordinal, section in enumerate(sections, start=1):
            section.ord = ordinal

        _log_thin_results(state.get("kb_id", ""), sections, chips, quiz)

        return {
            "sections": [section.model_dump() for section in sections],
            "chips": [chip.model_dump() for chip in chips],
            "quiz": [item.model_dump() for item in quiz],
            "pre_roll": state.get("pre_roll") or PreRoll().model_dump(),
        }


# ── pure helpers, unit-testable without a model ──────────────────────────────


def split_corpus(source_text: str, source_files: list[str], max_chars: int) -> list[Segment]:
    """Recover the individual documents from the corpus the web app concatenated.

    joinCorpus in services/web/lib/extract.ts writes "# SOURCE FILE: name" before each
    upload precisely so this is possible. Pasted text arrives without headers and comes
    back as one segment, which is correct: it is one document.
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
    """Attribute every section candidate to the document it came from.

    The model is asked for `source_name` but has no reason to get it right, and
    `write_section` writes each body from the documents its plan named. Stamping it here
    means provenance is a fact rather than something the model remembered.
    """

    for candidate in reading.section_candidates:
        candidate.source_name = source_name
        if candidate.source_kind is None or candidate.source_kind.value == "unknown":
            candidate.source_kind = reading.kind
    return reading


def dedupe_plans(plans: list[SectionPlan]) -> list[SectionPlan]:
    """Collapse planned sections that resolve to the same id.

    Two sections sharing an id is not a cosmetic problem: the id is what every chip and
    quiz item resolves against, so a duplicate turns each of those references into a coin
    flip between two different bodies. The first one wins, because the planner was told
    to order sections the way a stranger should read them.
    """

    seen: set[str] = set()
    unique: list[SectionPlan] = []
    for plan in plans:
        key = refs.normalize_ref(plan.identifier())
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(plan)
    return unique


def select_default_chips(chips: list[Chip], count: int) -> list[Chip]:
    """Mark the first `count` chips selected, unless the model already chose.

    The generator is told to put its strongest questions first, so "the first three" is a
    defensible default rather than an arbitrary one — and it is a default, which the
    candidate changes on the review screen.
    """

    if any(chip.selected for chip in chips):
        return chips
    for index, chip in enumerate(chips):
        chip.selected = index < count
    return chips


def usable_quiz_items(items: list[QuizItem]) -> list[QuizItem]:
    """Drop items the gate could not render or score.

    Exactly four non-empty choices, an answer index that points at one of them, and a
    question. Anything else is not a weak question — it is a broken screen, and no
    amount of reviewing on the candidate's part can fix a missing option.
    """

    usable: list[QuizItem] = []
    for item in items:
        if not item.question.strip():
            continue
        if len(item.choices) != QUIZ_CHOICE_COUNT:
            continue
        if any(not choice.strip() for choice in item.choices):
            continue
        if not 0 <= item.correct_index < QUIZ_CHOICE_COUNT:
            continue
        usable.append(item)
    return usable


def number_quiz_items(items: list[QuizItem]) -> list[QuizItem]:
    """Give every item a stable id, so a gate attempt can record what it sampled."""

    for index, item in enumerate(items, start=1):
        item.id = item.id.strip() or f"q{index:02d}"
    return items


def material_for(plan: SectionPlan, segments: list[Segment], max_chars: int) -> str:
    """The source text one section is written from.

    Named documents when the plan named any, everything otherwise. Truncated per document
    rather than by cutting the tail off the whole string, so a section drawing on four
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


def _section_ids(state: IngestState) -> list[str]:
    return [
        section_id(row.get("path", ""), row.get("anchor", "")) for row in state.get("sections", [])
    ]


def _section_digest(state: IngestState, *, with_body: bool = True) -> list[dict[str, Any]]:
    """The sections as the generators see them: id, title, summary, and maybe the body."""

    digest: list[dict[str, Any]] = []
    for row in state.get("sections", []):
        entry = {
            "id": section_id(row.get("path", ""), row.get("anchor", "")),
            "title": row.get("title", ""),
            "summary": row.get("summary", ""),
        }
        if with_body:
            entry["body_md"] = row.get("body_md", "")
        digest.append(entry)
    return digest


def _log_thin_results(
    kb_id: str, sections: list[Section], chips: list[Chip], quiz: list[QuizItem]
) -> None:
    """Warn about a thin run without failing it.

    None of these are errors: POC_UserJourney.md is explicit that a candidate with a
    sparse corpus still has a knowledge base worth publishing. They are worth logging
    because they are also what a truncated model response looks like.
    """

    if len(sections) < 8:
        logger.warning("thin_knowledge_base", kb_id=kb_id, sections=len(sections))
    if len(chips) < refs.TARGET_CHIPS:
        logger.info("thin_chips", kb_id=kb_id, chips=len(chips))
    if len(quiz) < refs.TARGET_QUIZ_ITEMS:
        logger.info("thin_quiz", kb_id=kb_id, quiz=len(quiz))

    empty = [
        category.value
        for category in QuizCategory
        if not any(item.category is category for item in quiz)
    ]
    if empty:
        # The gate samples one item per category. An empty category means it cannot, and
        # the review screen says so — better a warning now than a booking gate that
        # quietly asks three questions.
        logger.warning("empty_quiz_categories", kb_id=kb_id, categories=empty)

    lookups = [
        item.id for item in quiz if refs.looks_ctrl_f_answerable(item.choices, item.correct_index)
    ]
    if lookups:
        # Assertion B8, reported rather than enforced. See app/graph/refs.py.
        logger.info("ctrl_f_answerable_quiz_items", kb_id=kb_id, items=lookups)


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
    builder.add_node("plan_sections", nodes.plan_sections, metadata=LLM_NODE)
    builder.add_node("write_section", nodes.write_section, metadata=LLM_NODE)
    builder.add_node("generate_chips", nodes.generate_chips, metadata=LLM_NODE)
    builder.add_node("generate_quiz", nodes.generate_quiz, metadata=LLM_NODE)
    builder.add_node("verify_refs", nodes.verify_refs, metadata=WORKFLOW_NODE)
    builder.add_node("repair_refs", nodes.repair_refs, metadata=LLM_NODE)
    builder.add_node("write_pre_roll", nodes.write_pre_roll, metadata=LLM_NODE)
    builder.add_node("assemble", nodes.assemble, metadata=WORKFLOW_NODE)

    builder.add_edge(START, "sanitize")
    builder.add_edge("sanitize", "segment")
    # Every loop is entered through a router that has already checked there is something
    # to iterate over. The three of them — after_segment, after_plan, after_write — are
    # the same guard at three depths, and each one is the difference between an empty
    # input finishing cleanly and an IndexError retried three times under Temporal.
    builder.add_conditional_edges(
        "segment", nodes.after_segment, ["read_segment", "generate_chips"]
    )
    builder.add_conditional_edges(
        "read_segment", nodes.after_read, ["read_segment", "plan_sections"]
    )
    builder.add_conditional_edges(
        "plan_sections", nodes.after_plan, ["write_section", "generate_chips"]
    )
    builder.add_conditional_edges(
        "write_section", nodes.after_write, ["write_section", "generate_chips"]
    )
    # Chips and quiz both cite sections, so both are generated before either is checked,
    # and one verify/repair loop covers them together.
    builder.add_edge("generate_chips", "generate_quiz")
    builder.add_edge("generate_quiz", "verify_refs")
    builder.add_conditional_edges(
        "verify_refs", nodes.after_verify, ["repair_refs", "write_pre_roll"]
    )
    # Back to the check rather than straight on: a repair that did not find a real
    # section must be seen as still unresolved, not assumed fixed.
    builder.add_edge("repair_refs", "verify_refs")
    builder.add_edge("write_pre_roll", "assemble")
    builder.add_edge("assemble", END)
    return builder
