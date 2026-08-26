"""The fixture's traps, run against a real model.

These are the assertions from docs/productDocs/fixtures/README.md that the unit tests
cannot make. A3 (the disagreeing guest), A4 (the retraction), A5 (the craft trap) and A6
(dedup) are claims about a *model's judgement* over `source.md`. Running them against
the fixture model would prove nothing: it answers with the reference output by
construction.

So they are an eval, not a unit test, and they are honest about costing money:

    RUN_MODEL_EVAL=1 MODEL_PROVIDER=anthropic ANTHROPIC_API_KEY=... \\
        uv run pytest -m eval -v

Run this before changing a prompt in app/graph/prompts.py and after. The one that
matters most is A3: the fixture calls it "the assertion most likely to fail and the most
expensive one to ship broken", because in production it means a tutor that argues for
things the Specialist publicly opposes, in their voice.
"""

import asyncio
import os

import pytest
from app.core.ingest_model import build_ingestion_model
from app.core.settings import Settings
from app.graph.anchors import is_quote_anchored
from app.graph.ingest import IngestNodes, build_ingest_graph

pytestmark = [
    pytest.mark.eval,
    pytest.mark.skipif(
        os.getenv("RUN_MODEL_EVAL") != "1",
        reason="needs a real model and an API key; set RUN_MODEL_EVAL=1",
    ),
]

# Assertion A3. Tomás Reiner argues these on the podcast in Part 3. Dana does not hold
# either, and her rebuttal to the second is legitimately hers.
GUEST_CLAIMS = (
    ("publish", "full", "pricing", "publicly"),
    ("discount", "marquee"),
)


@pytest.fixture(scope="module")
def ingested(request: pytest.FixtureRequest) -> dict:
    """One real ingestion of source.md, shared by every assertion below.

    Module-scoped deliberately: this is a two-minute, several-dollar call, and running
    it once per assertion would make the eval something nobody runs. `asyncio.run` on
    its own loop rather than pytest-asyncio, because this fixture outlives the
    function-scoped loop the async tests get.
    """

    settings = Settings()
    if settings.model_provider == "fake":
        pytest.skip("the eval needs a real MODEL_PROVIDER")

    source = request.getfixturevalue("source_text")
    nodes = IngestNodes(settings=settings, model=build_ingestion_model(settings))
    graph = build_ingest_graph(nodes).compile()
    return asyncio.run(
        graph.ainvoke(
            {
                "course_id": "eval",
                "specialist_name": "Dana Mercado",
                "title": "Hold Your Number",
                "tagline": "The deal is won or lost long before anyone says a price.",
                "source_text": source,
                "source_files": ["source.md"],
            }
        )
    )


def claims(ingested: dict) -> list[str]:
    return [position["claim"].lower() for position in ingested["positions"]]


def test_a1_lessons_are_capabilities_not_topics(ingested: dict) -> None:
    lessons = ingested["lessons"]

    assert 5 <= len(lessons) <= 9, f"{len(lessons)} lessons"
    not_capabilities = [
        lesson["title"]
        for lesson in lessons
        if not lesson["objective"].strip().lower().startswith("can ")
    ]
    assert not_capabilities == [], f"objectives that are topics: {not_capabilities}"


def test_a2_every_quote_is_verbatim(ingested: dict, source_text: str) -> None:
    unanchored = [
        position["claim"]
        for position in ingested["positions"]
        if position["quote"] and not is_quote_anchored(position["quote"], source_text)
    ]

    # assemble() clears a quote it cannot anchor, so anything left must be real. A
    # failure here means the clearing step is broken, not that the model hallucinated.
    assert unanchored == []


def test_a3_the_guests_positions_are_not_extracted(ingested: dict) -> None:
    """The most expensive assertion to ship broken.

    A guest arguing against the author reads exactly like the author being contrarian.
    Getting this wrong ships a tutor that argues, in Dana's voice, for things Dana
    publicly opposes.
    """

    extracted = claims(ingested)
    for words in GUEST_CLAIMS:
        matches = [claim for claim in extracted if all(word in claim for word in words)]
        assert matches == [], f"a guest's position was extracted as the author's: {matches}"


def test_a4_the_retracted_rule_is_not_a_live_position(ingested: dict) -> None:
    """Parts 1–2 say "never bill hourly, ever". Part 5 is a public walkback.

    A pass either omits hourly entirely or captures the current nuanced stance. Emitting
    the absolute is a fail: the tutor would defend a stance its Specialist has retracted.
    """

    absolutes = [
        claim
        for claim in claims(ingested)
        if "hourly" in claim and ("never" in claim or "ever" in claim) and "unless" not in claim
    ]

    assert absolutes == [], f"a retracted absolute survived: {absolutes}"


def test_a5_the_handout_yields_craft_not_opinions(ingested: dict) -> None:
    """Part 6 is payment terms, SOW structure, effective-rate maths. Correct and useful;
    not contested. It belongs in key_points and body_md."""

    craft_words = ("payment terms", "change order", "sow", "statement of work")
    as_positions = [
        claim for claim in claims(ingested) if any(word in claim for word in craft_words)
    ]
    assert as_positions == [], f"craft was extracted as opinion: {as_positions}"

    # And it did land somewhere: a course that drops Part 6 entirely is also a failure.
    body = " ".join(
        lesson["body_md"].lower() + " " + " ".join(lesson["key_points"]).lower()
        for lesson in ingested["lessons"]
    )
    assert any(word in body for word in craft_words), "Part 6 never reached the lessons"


def test_a6_restated_claims_are_one_position(ingested: dict) -> None:
    """The price-objection claim appears in Part 1 and again, differently worded, in
    Part 4. One position, not two."""

    price_objection = [
        claim
        for claim in claims(ingested)
        if "price objection" in claim or "about the price" in claim
    ]

    assert len(price_objection) <= 1, f"the same belief twice: {price_objection}"


def test_a7_position_count_is_in_range(ingested: dict) -> None:
    count = len(ingested["positions"])

    # Below 5, check whether A3/A4/A5 over-filtered. Above 9, craft is being extracted
    # as opinion.
    assert 5 <= count <= 8, f"{count} positions"


def test_the_voice_card_captures_this_person_specifically(ingested: dict) -> None:
    """Dana quotes her own scripts and reaches for pump-plant analogies. A voice card
    that would fit any consultant is one the tutor cannot speak from."""

    voice = ingested["voice_card"]
    register = voice["register"].lower()

    assert voice["register"], "no register"
    assert voice["pet_peeves"], "no pet peeves"
    assert any(
        word in register for word in ("pump", "procurement", "industrial", "plant", "part number")
    ), f"the register is generic: {voice['register']}"
