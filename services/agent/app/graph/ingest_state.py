from typing import Any, TypedDict


class IngestState(TypedDict, total=False):
    """State threaded through the ingestion graph.

    Everything here is plain JSON — dicts and lists rather than Pydantic instances —
    because state crosses the workflow/activity boundary on every node transition and
    lands in Temporal's event history. Keeping it plain means a run is readable in the
    Temporal UI and a schema change cannot break the replay of a run already in flight.
    Nodes validate into the models in app/core/kb_schemas.py at their own edges.
    """

    # ── input ────────────────────────────────────────────────────────────────
    kb_id: str
    candidate_name: str
    title: str
    tagline: str
    source_text: str
    source_files: list[str]

    # ── sanitize ─────────────────────────────────────────────────────────────
    safety_flags: list[str]

    # ── segment / read_segment ───────────────────────────────────────────────
    segments: list[dict[str, Any]]
    # Index of the next document to read. The read loop is a self-edge, so this cursor is
    # what advances it and what the router tests for completion.
    segment_cursor: int
    summaries: list[str]
    section_candidates: list[dict[str, Any]]
    # These four accumulators mirror the quiz's four categories. They are kept apart
    # rather than merged into one "findings" list because `generate_quiz` needs to know
    # when a category has nothing behind it — an empty `limits` list is a warning to
    # surface, not something to paper over with an invented question.
    facts: list[str]
    opinions: list[str]
    limits: list[str]
    motivations: list[str]

    # ── plan_sections / write_section ────────────────────────────────────────
    section_plans: list[dict[str, Any]]
    section_cursor: int
    sections: list[dict[str, Any]]

    # ── generate_chips / generate_quiz ───────────────────────────────────────
    chips: list[dict[str, Any]]
    quiz: list[dict[str, Any]]

    # ── verify_refs / repair_refs ────────────────────────────────────────────
    # Indexes into `chips` and `quiz` whose section reference names nothing. Recomputed
    # by verify_refs on every pass, so a repair either fixes an entry or it does not.
    unresolved_chips: list[int]
    unresolved_quiz: list[int]
    repair_attempts: int

    # ── pre_roll ─────────────────────────────────────────────────────────────
    pre_roll: dict[str, Any]

    # ── progress ─────────────────────────────────────────────────────────────
    # Append-only status lines. The workflow reads them out through get_progress and the
    # gateway forwards the ones it has not sent, tracking position by count — so a line
    # must never be rewritten or reordered once added.
    status_lines: list[str]
