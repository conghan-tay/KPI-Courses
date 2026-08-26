from typing import Any, TypedDict


class IngestState(TypedDict, total=False):
    """State threaded through the ingestion graph.

    Everything here is plain JSON — dicts and lists rather than Pydantic instances —
    because state crosses the workflow/activity boundary on every node transition and
    lands in Temporal's event history. Keeping it plain means a run is readable in the
    Temporal UI and a schema change cannot break the replay of a run already in flight.
    Nodes validate into the models in app/core/course_schemas.py at their own edges.
    """

    # ── input ────────────────────────────────────────────────────────────────
    course_id: str
    specialist_name: str
    title: str
    tagline: str
    source_text: str
    source_files: list[str]

    # ── sanitize ─────────────────────────────────────────────────────────────
    safety_flags: list[str]

    # ── segment / read_segment ───────────────────────────────────────────────
    segments: list[dict[str, Any]]
    # Index of the next segment to read. The read loop is a self-edge, so this cursor is
    # what advances it and what the router tests for completion.
    segment_cursor: int
    summaries: list[str]
    candidates: list[dict[str, Any]]
    craft_points: list[str]

    # ── resolve_positions / verify_quotes / repair_quotes ────────────────────
    positions: list[dict[str, Any]]
    # Indexes into `positions` whose quote is not in the source. Recomputed by
    # verify_quotes on every pass, so a repair either fixes an entry or it does not.
    unanchored: list[int]
    repair_attempts: int

    # ── plan_lessons / write_lesson ──────────────────────────────────────────
    lesson_plans: list[dict[str, Any]]
    lesson_cursor: int
    lessons: list[dict[str, Any]]

    # ── voice ────────────────────────────────────────────────────────────────
    voice_card: dict[str, Any]

    # ── progress ─────────────────────────────────────────────────────────────
    # Append-only status lines. The workflow reads them out through get_progress and the
    # gateway forwards the ones it has not sent, tracking position by count — so a line
    # must never be rewritten or reordered once added.
    status_lines: list[str]
