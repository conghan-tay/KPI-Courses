"""Assertion B2 from docs/productDocs/fixtures/README.md, running in CI.

"Every `chips[].kb_section` and every `quiz[].source_section` must resolve to a section
id that exists. This is the one assertion that is a plain string match, and it is the
highest-value one — it is the hallucination canary."

The first tests below are that assertion against the real fixture. The rest pin down the
normalisation, because this module has a twin in services/web/lib/refs.ts that decides
which cards get the warning treatment, and the two disagreeing would mean the review
screen and the pipeline tell the candidate different stories.
"""

from typing import Any

from app.core.kb_schemas import QuizCategory, section_id
from app.graph.refs import (
    QUIZ_PER_CATEGORY,
    SELECTED_CHIPS,
    TARGET_CHIPS,
    TARGET_QUIZ_ITEMS,
    looks_ctrl_f_answerable,
    normalize_ref,
    resolve,
    unresolved_indexes,
)


def fixture_section_ids(expected: dict[str, Any]) -> list[str]:
    return [section_id(row["path"], row.get("anchor", "")) for row in expected["sections"]]


# ── B2, against the real fixture ─────────────────────────────────────────────


def test_every_fixture_chip_cites_a_section_that_exists(expected: dict[str, Any]) -> None:
    ids = fixture_section_ids(expected)
    dangling = [chip["text"] for chip in expected["chips"] if not resolve(chip["kb_section"], ids)]

    assert dangling == [], f"{len(dangling)} chips cite a section that is not there"


def test_every_fixture_quiz_item_cites_a_section_that_exists(expected: dict[str, Any]) -> None:
    ids = fixture_section_ids(expected)
    dangling = [item["id"] for item in expected["quiz"] if not resolve(item["source_section"], ids)]

    assert dangling == [], f"{len(dangling)} quiz items cite a section that is not there"


def test_section_ids_are_unique(expected: dict[str, Any]) -> None:
    """Two sections sharing an id turn every reference to it into a coin flip."""

    ids = fixture_section_ids(expected)

    assert len(set(ids)) == len(ids)


# ── B6 and B7, the counts the fixture is meant to demonstrate ────────────────


def test_the_fixture_has_eight_chips_with_three_selected(expected: dict[str, Any]) -> None:
    assert len(expected["chips"]) == TARGET_CHIPS
    assert sum(chip["selected"] for chip in expected["chips"]) == SELECTED_CHIPS
    # All three registers present, and every chip short enough to read as typed.
    assert {chip["register"] for chip in expected["chips"]} == {
        "skeptical",
        "narrative",
        "blunt",
    }
    assert all(len(chip["text"].split()) < 12 for chip in expected["chips"])


def test_the_fixture_quiz_is_balanced(expected: dict[str, Any]) -> None:
    """The gate samples one item per category, which only works if all four are filled."""

    assert len(expected["quiz"]) == TARGET_QUIZ_ITEMS
    for category in QuizCategory:
        count = sum(1 for item in expected["quiz"] if item["category"] == category.value)
        assert count == QUIZ_PER_CATEGORY, f"{category.value} has {count}"


def test_the_fixture_quiz_avoids_ctrl_f_answers(expected: dict[str, Any]) -> None:
    """B8. quiz_example_prompt.txt disqualifies questions whose answer is a number, and
    fixtures/README.md records that five of the supplied examples were exactly that."""

    lookups = [
        item["id"]
        for item in expected["quiz"]
        if looks_ctrl_f_answerable(item["choices"], item["correct_index"])
    ]

    assert lookups == [], f"{lookups} are answerable by ctrl-F"


# ── the normalisation, which has a twin in TypeScript ────────────────────────


def test_a_similar_id_is_not_a_match() -> None:
    ids = ["agoda/psp-routing#circuit-breakers"]

    assert resolve("agoda/psp-routing", ids) is None
    assert resolve("agoda/psp-routing#breakers", ids) is None
    assert resolve("", ids) is None
    assert resolve("   ", ids) is None


def test_case_and_stray_separators_do_not_count_as_invention() -> None:
    """A model that found the right section and shouted it has not hallucinated."""

    ids = ["agoda/psp-routing#circuit-breakers"]

    assert resolve("Agoda/PSP-Routing#Circuit-Breakers", ids) == ids[0]
    assert resolve("  #agoda/psp-routing#circuit-breakers  ", ids) == ids[0]


def test_resolve_returns_the_canonical_id_rather_than_true() -> None:
    """`repair_refs` writes the result back, so returning the caller's spelling would
    leave a reference that fails again on the next run."""

    ids = ["postgres/queue-workers"]

    assert resolve("POSTGRES/QUEUE-WORKERS", ids) == "postgres/queue-workers"


def test_unresolved_indexes_reports_positions_not_ids() -> None:
    ids = ["a/one", "b/two"]
    refs = ["a/one", "c/three", "", "  "]

    assert unresolved_indexes(refs, ids) == [1, 2, 3]


def test_normalisation_is_idempotent() -> None:
    """Both sides of the wire normalise; normalising twice must not drift."""

    once = normalize_ref("  #Agoda/PSP-Routing#Circuit-Breakers/ ")

    assert normalize_ref(once) == once


def test_section_id_joins_the_same_way_on_both_sides() -> None:
    assert section_id("agoda/psp-routing", "circuit-breakers") == (
        "agoda/psp-routing#circuit-breakers"
    )
    # No anchor means the path is the whole id — not a trailing "#".
    assert section_id("postgres/opinions", "") == "postgres/opinions"
    assert section_id("/postgres/opinions/", "#deferred") == "postgres/opinions#deferred"


# ── B8's heuristic ───────────────────────────────────────────────────────────


def test_a_numeric_answer_is_reported_as_a_lookup() -> None:
    assert looks_ctrl_f_answerable(["Two", "Four", "Seven", "Free text"], 1)
    assert looks_ctrl_f_answerable(["About 60%", "About 78%", "About 94%", "99.9%"], 2)
    assert looks_ctrl_f_answerable(["210ms", "9s", "1m", "4h"], 0)


def test_an_answer_that_happens_to_contain_a_number_is_not_a_lookup() -> None:
    """The rule is "the answer IS a number", not "the answer mentions one" — otherwise
    every question about a system with a threshold in it gets flagged."""

    assert not looks_ctrl_f_answerable(
        [
            "Five consecutive failures, because that is the fast path for a dead provider",
            "Any single 5xx response",
            "A manual toggle",
            "Nothing — it is time-based",
        ],
        0,
    )


def test_an_out_of_range_answer_is_not_reported_as_a_lookup() -> None:
    """A malformed item is `usable_quiz_items`' problem, not this heuristic's."""

    assert not looks_ctrl_f_answerable(["a", "b"], 7)
