"""Quote anchoring: assertion A2 from docs/productDocs/fixtures/README.md.

Every `positions[].quote` must appear verbatim in the source text. It is the one check
that is a plain string match, and it is the highest-value one — a position with no
anchor is a position the model may have invented, and a tutor that argues an invented
stance in the Specialist's voice damages the Specialist.

This is a deliberate twin of normalizeForMatch/isQuoteAnchored in
services/web/lib/quotes.ts. The review screen runs the same check on the same data to
decide which cards get the warning treatment, so the two must agree character for
character. If you change the normalisation here, change it there.
"""

import re

# Typography is normalised before comparing. A model that re-types a quote correctly but
# straightens an apostrophe has not hallucinated anything, and failing it for that would
# train everyone to ignore the warning.
_SINGLE_QUOTES = re.compile(r"[‘’ʼ]")
_DOUBLE_QUOTES = re.compile(r"[“”]")
_DASHES = re.compile(r"[–—]")
_WHITESPACE = re.compile(r"\s+")


def normalize_for_match(text: str) -> str:
    normalized = _SINGLE_QUOTES.sub("'", text)
    normalized = _DOUBLE_QUOTES.sub('"', normalized)
    normalized = _DASHES.sub("-", normalized)
    normalized = normalized.replace("…", "...")
    return _WHITESPACE.sub(" ", normalized).strip().lower()


def is_quote_anchored(quote: str, source_text: str) -> bool:
    """True when `quote` is a span genuinely present in `source_text`.

    An empty quote is not anchored. That is not pedantry: "no quote" and "a quote that
    isn't in the source" are the same failure from the reader's point of view, and both
    should get the same warning.
    """

    if not quote or not quote.strip():
        return False
    return normalize_for_match(quote) in normalize_for_match(source_text)


def unanchored_indexes(quotes: list[str], source_text: str) -> list[int]:
    """Positions in the list whose quote could not be found. Cheap to call repeatedly.

    The source text is normalised once here rather than once per quote, which matters:
    the corpus is up to 400k characters and there can be eight quotes.
    """

    haystack = normalize_for_match(source_text)
    return [
        index
        for index, quote in enumerate(quotes)
        if not quote or not quote.strip() or normalize_for_match(quote) not in haystack
    ]


# POC_UserJourney.md — "fewer than 3 positions found → warn but allow publish". Mirrors
# THIN_POSITIONS_THRESHOLD in services/web/lib/quotes.ts.
THIN_POSITIONS_THRESHOLD = 3
