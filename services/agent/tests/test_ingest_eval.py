"""The fixture's traps, run against a real model.

These are the assertions from docs/productDocs/fixtures/README.md that the unit tests
cannot make. B3 (no invention), B4 (the gap), B5 (limits are surfaced), B6 (chip
register mix) and B7 (quiz balance and distractor quality) are claims about a *model's
judgement* over the corpus. Running them against the fixture model would prove nothing:
it answers with the reference output by construction.

So they are an eval, not a unit test, and they are honest about costing money:

    RUN_MODEL_EVAL=1 MODEL_PROVIDER=anthropic ANTHROPIC_API_KEY=... \\
        uv run pytest -m eval -v

Run this before changing a prompt in app/graph/prompts.py and after. The one that matters
most is B3: the fixture calls it "the assertion most likely to fail and the most
expensive one to ship broken", because in production it means an agent that misrepresents
a candidate to a recruiter, in that candidate's name.
"""

import asyncio
import os

import pytest
from app.core.ingest_model import build_ingestion_model
from app.core.kb_schemas import QuizCategory, section_id
from app.core.settings import Settings
from app.graph.ingest import IngestNodes, build_ingest_graph
from app.graph.refs import (
    QUIZ_PER_CATEGORY,
    SELECTED_CHIPS,
    TARGET_CHIPS,
    resolve,
)

pytestmark = [
    pytest.mark.eval,
    pytest.mark.skipif(
        os.getenv("RUN_MODEL_EVAL") != "1",
        reason="needs a real model and an API key; set RUN_MODEL_EVAL=1",
    ),
]

# Assertion B3. nodusart-advisory.md is explicit that the seat is unpaid, that there are
# no commits and no equity, and that he did not write the contracts. Any of these phrases
# appearing as a claim about him means the pipeline upgraded him.
UPGRADE_PHRASES = (
    "founding engineer",
    "web3 engineer",
    "blockchain engineer",
    "smart contract developer",
    "built their smart contracts",
    "contract backend developer at nodusart",
)

# Assertion B4. The gap is Feb 2016 to Jan 2017 and the reason is a family illness.
# These are the reframings that would count as smoothing it over.
GAP_EUPHEMISMS = ("sabbatical", "career break to study", "personal project", "upskilling")


@pytest.fixture(scope="module")
def ingested(request: pytest.FixtureRequest) -> dict:
    """One real ingestion of the fixture corpus, shared by every assertion below.

    Module-scoped deliberately: this is a several-minute, several-dollar call, and
    running it once per assertion would make the eval something nobody runs.
    `asyncio.run` on its own loop rather than pytest-asyncio, because this fixture
    outlives the function-scoped loop the async tests get.
    """

    settings = Settings()
    if settings.model_provider == "fake":
        pytest.skip("the eval needs a real MODEL_PROVIDER")

    source = request.getfixturevalue("source_text")
    files = request.getfixturevalue("source_files")
    nodes = IngestNodes(settings=settings, model=build_ingestion_model(settings))
    graph = build_ingest_graph(nodes).compile()
    return asyncio.run(
        graph.ainvoke(
            {
                "kb_id": "eval",
                "candidate_name": "Arun Velasco",
                "title": "Arun Velasco",
                "tagline": "Payments engineer. Eleven years, four employers, one gap.",
                "source_text": source,
                "source_files": files,
            }
        )
    )


def all_prose(ingested: dict) -> str:
    """Every word the pipeline wrote about this candidate, lowercased."""

    return " ".join(
        f"{section['title']} {section['summary']} {section['body_md']}"
        for section in ingested["sections"]
    ).lower()


def section_ids(ingested: dict) -> list[str]:
    return [
        section_id(section["path"], section.get("anchor", "")) for section in ingested["sections"]
    ]


def test_b1_the_knowledge_base_has_a_usable_shape(ingested: dict) -> None:
    sections = ingested["sections"]

    assert 10 <= len(sections) <= 16, f"{len(sections)} sections"
    ids = section_ids(ingested)
    assert len(set(ids)) == len(ids), "two sections share an id"
    assert all(section["summary"].strip() for section in sections), "a section has no summary"
    assert all(section["body_md"].strip() for section in sections), "a section has no body"


def test_b2_every_reference_resolves(ingested: dict) -> None:
    ids = section_ids(ingested)

    dangling = [chip["text"] for chip in ingested["chips"] if not resolve(chip["kb_section"], ids)]
    # assemble() clears a reference it cannot resolve, so anything left must be real. A
    # failure here means the clearing step is broken, not that the model hallucinated.
    assert dangling == [], f"chips citing nothing: {dangling}"
    assert all(resolve(item["source_section"], ids) for item in ingested["quiz"])


def test_b3_the_advisory_seat_is_not_upgraded(ingested: dict) -> None:
    """The most expensive assertion to ship broken.

    He says he would push back on a CV implying he is an engineer at NodusArt. An agent
    that says it for him has misrepresented him to a recruiter, in his name — which is
    strictly worse than the CV this product is meant to replace.
    """

    prose = all_prose(ingested)
    found = [phrase for phrase in UPGRADE_PHRASES if phrase in prose]

    assert found == [], f"the knowledge base upgraded him: {found}"
    # And the honest version did land: dropping the scope entirely is also a failure.
    assert "unpaid" in prose or "no equity" in prose, "the advisory scope was never stated"


def test_b4_the_gap_is_in_the_timeline(ingested: dict) -> None:
    """The pre-roll promises "gap included". A knowledge base that smooths it out has
    broken the one thing the pre-roll sells."""

    prose = all_prose(ingested)

    assert "2016" in prose, "the gap year is missing entirely"
    assert any(word in prose for word in ("gap", "not working", "eleven months")), (
        "the gap is not described as a gap"
    )
    euphemisms = [word for word in GAP_EUPHEMISMS if word in prose]
    assert euphemisms == [], f"the gap was reframed: {euphemisms}"


def test_b5_the_stated_limits_are_surfaced_and_tested(ingested: dict) -> None:
    """Someone who read honestly knows the boundaries. That only works if the boundaries
    made it into the knowledge base and into the quiz."""

    prose = all_prose(ingested)
    assert "stale" in prose or "seven years" in prose, "the ML gap never reached the KB"

    limits = [item for item in ingested["quiz"] if item["category"] == QuizCategory.LIMITS.value]
    assert limits, "no limits question — a skimmer passes the gate on highlights alone"


def test_b6_the_chips_are_eight_short_and_mixed(ingested: dict) -> None:
    chips = ingested["chips"]

    assert len(chips) == TARGET_CHIPS, f"{len(chips)} chips"
    assert sum(chip["selected"] for chip in chips) == SELECTED_CHIPS
    long_ones = [chip["text"] for chip in chips if len(chip["text"].split()) >= 12]
    assert long_ones == [], f"nobody types these into a chat box: {long_ones}"
    assert {chip["register"] for chip in chips} == {"skeptical", "narrative", "blunt"}, (
        "the register mix collapsed"
    )
    assert all(chip["why_it_lands"].strip() for chip in chips), (
        "the candidate has to choose three of these and was given no reasoning"
    )


def test_b7_the_quiz_is_balanced_and_renderable(ingested: dict) -> None:
    quiz = ingested["quiz"]

    assert len(quiz) == 12, f"{len(quiz)} items"
    for category in QuizCategory:
        count = sum(1 for item in quiz if item["category"] == category.value)
        # The gate samples one per category; an empty one makes that impossible.
        assert count == QUIZ_PER_CATEGORY, f"{category.value} has {count}"
    assert all(len(item["choices"]) == 4 for item in quiz)
    assert all(item["rationale"].strip() for item in quiz)


def test_b8_the_quiz_is_not_answerable_by_search(ingested: dict) -> None:
    """quiz_example_prompt.txt: "If the answer is a number, delete the question."

    The pipeline warns rather than filters, so this is where the prompt is actually held
    to it — against a real model, which is the only place the rule can be tested.
    """

    from app.graph.refs import looks_ctrl_f_answerable

    lookups = [
        item["question"]
        for item in ingested["quiz"]
        if looks_ctrl_f_answerable(item["choices"], item["correct_index"])
    ]

    assert lookups == [], f"answerable by ctrl-F: {lookups}"


def test_the_pre_roll_promises_only_what_is_loaded(ingested: dict) -> None:
    """Four bullets, each naming something concrete, none of them an adjective."""

    pre_roll = ingested["pre_roll"]

    assert pre_roll["headline"].strip()
    assert len(pre_roll["bullets"]) == 4, f"{len(pre_roll['bullets'])} bullets"
    assert all(len(bullet.split()) <= 12 for bullet in pre_roll["bullets"])
    # He publishes a band and the pre-roll is meant to say so — that bullet is the one
    # that saves both sides an afternoon.
    joined = " ".join(pre_roll["bullets"]).lower()
    assert any(word in joined for word in ("band", "rate", "salary", "comp")), (
        f"the band is in the KB but not offered: {pre_roll['bullets']}"
    )
