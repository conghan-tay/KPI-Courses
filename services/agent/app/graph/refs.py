"""Section-reference resolution: assertion B2 from docs/productDocs/fixtures/README.md.

Every `chips[].kb_section` and every `quiz[].source_section` must name a section that
actually exists. It is the one check that is a plain string comparison, and it is the
highest-value one — a chip pointing at nothing is a chip the model may have invented, and
an agent citing a section that was never written misrepresents the candidate to a
recruiter, in the candidate's name.

This is a deliberate twin of normalizeRef/isRefResolved in services/web/lib/refs.ts. The
review screen runs the same check on the same data to decide which cards get the warning
treatment, so the two must agree character for character. Change one, change the other.
"""

import re

# Ids are slugs, so normalisation is narrow on purpose: case, surrounding whitespace, and
# stray leading or trailing separators. Nothing else. A reference that differs from a
# section id by more than that is a different reference, and treating it as a match would
# be exactly the false confidence this check exists to prevent.
_EDGES = re.compile(r"^[#/\s]+|[#/\s]+$")


def normalize_ref(ref: str) -> str:
    return _EDGES.sub("", ref).strip().lower()


def resolve(ref: str, section_ids: list[str]) -> str | None:
    """The section id `ref` names, or None.

    Returns the canonical id rather than a boolean so `repair_refs` can write the
    corrected spelling back: a model that answers `Agoda/PSP-Routing#Circuit-Breakers`
    has found the right section and only needs its casing fixed, and keeping the wrong
    spelling would leave a reference that fails again on the next run.
    """

    if not ref or not ref.strip():
        return None
    needle = normalize_ref(ref)
    for section_id in section_ids:
        if normalize_ref(section_id) == needle:
            return section_id
    return None


def unresolved_indexes(refs: list[str], section_ids: list[str]) -> list[int]:
    """Positions in the list whose reference names no section.

    An empty reference counts as unresolved. That is not pedantry: "no source" and "a
    source that does not exist" are the same thing from a reader's point of view, and
    both deserve the same warning.
    """

    known = {normalize_ref(section_id) for section_id in section_ids}
    return [
        index
        for index, ref in enumerate(refs)
        if not ref or not ref.strip() or normalize_ref(ref) not in known
    ]


# Fixture assertion B6: eight chips is the target, and three are selected for the public
# page. Below the target the review screen warns; it never blocks, because a candidate
# with a thin corpus still has a knowledge base worth publishing.
TARGET_CHIPS = 8
SELECTED_CHIPS = 3

# Fixture assertion B7: twelve items, three per category, four choices each.
TARGET_QUIZ_ITEMS = 12
QUIZ_PER_CATEGORY = 3

# B8. "About 94%", "Four", "210ms", "5" — an answer whose entire content is a quantity.
_BARE_QUANTITY = re.compile(
    r"(about|roughly|approximately|~)?\s*"
    r"([\d.,]+\s*[%a-z]{0,3}|one|two|three|four|five|six|seven|eight|nine|ten)"
)


def looks_ctrl_f_answerable(choices: list[str], correct_index: int) -> bool:
    """B8: the correct answer is a bare number, so the question is a lookup, not a test.

    quiz_example_prompt.txt says to delete these. This only *reports* them — `assemble`
    logs and the review screen warns — because a filter that silently deletes a
    candidate's question is worse than a warning they are free to ignore. The rule is
    enforced where a human can overrule it.
    """

    if not 0 <= correct_index < len(choices):
        return False
    return bool(_BARE_QUANTITY.fullmatch(choices[correct_index].strip().lower()))
