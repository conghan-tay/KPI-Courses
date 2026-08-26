"""Assertion A2 from docs/productDocs/fixtures/README.md, running in CI.

"Every `positions[].quote` must appear verbatim in `source.md`. This is the one
assertion you can run as a string match, and it's the highest-value one — it's your
hallucination canary."

The first test below is that assertion against the real fixture. The rest pin down the
normalisation, because this module has a twin in services/web/lib/quotes.ts that decides
which position cards get the warning treatment, and the two disagreeing would mean the
review screen and the pipeline tell the Specialist different stories.
"""

from typing import Any

from app.graph.anchors import (
    is_quote_anchored,
    normalize_for_match,
    unanchored_indexes,
)


def test_every_fixture_quote_is_anchored_in_the_source(
    expected: dict[str, Any], source_text: str
) -> None:
    unanchored = [
        position["claim"]
        for position in expected["positions"]
        if not is_quote_anchored(position.get("quote", ""), source_text)
    ]

    assert unanchored == [], f"{len(unanchored)} fixture quotes are not in source.md"
    # A2 also fixes the count: seven positions, seven anchors.
    assert len(expected["positions"]) == 7


def test_a_paraphrase_is_not_an_anchor() -> None:
    source = "A price objection is almost never about the price."

    assert not is_quote_anchored("A price objection is rarely about price.", source)
    assert not is_quote_anchored("", source)
    assert not is_quote_anchored("   ", source)


def test_typography_does_not_count_as_hallucination() -> None:
    """A model that re-types a quote correctly but straightens an apostrophe has not
    invented anything, and failing it for that trains everyone to ignore the warning."""

    source = "Don’t discount — you’ll never get the number back…"

    assert is_quote_anchored("Don't discount - you'll never get the number back...", source)


def test_whitespace_and_case_are_normalised() -> None:
    source = "They went with\n   someone   cheaper"

    assert is_quote_anchored("they went with someone cheaper", source)


def test_unanchored_indexes_reports_positions_not_claims() -> None:
    source = "the first claim appears here"
    quotes = ["the first claim", "invented", "", "  "]

    assert unanchored_indexes(quotes, source) == [1, 2, 3]


def test_normalisation_is_idempotent() -> None:
    """Both sides of the wire normalise; normalising twice must not drift."""

    once = normalize_for_match("A  “quoted”  thing — with … marks")

    assert normalize_for_match(once) == once
