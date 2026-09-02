"""Journey 1 against the running stack: documents → a published knowledge base.

This is the only test that exercises the cross-language contract for real. The Go
structs, the Pydantic models and the zod schemas agree by convention — a renamed JSON
tag surfaces as a workflow task failure or a client-side parse error, never as a compile
error — and this is what catches that.

It also covers the two things unit tests structurally cannot: that a durable run started
by one process is persisted by it after the pipeline has finished, and that a retry works
from stored source text with no re-upload.

    make test-e2e
"""

import json
import os
import time

import httpx
import pytest

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(os.getenv("RUN_E2E") != "1", reason="set RUN_E2E=1 for stack tests"),
]

GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8080")
WEB_URL = os.getenv("WEB_URL", "http://localhost:3000")
HEADERS = {
    "X-API-Key": os.getenv("API_KEY", "local-api-key"),
    # The server-side half of the SIGN IN AS switcher, seeded by migration.
    "X-Candidate-Id": "user-arun",
}
INGEST_TIMEOUT_SECONDS = 180

FIXTURES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "docs",
    "productDocs",
    "fixtures",
)

# The seven documents the dropzone sends, in order.
FIXTURE_FILES = [
    "resume.md",
    "agoda-supplier-payouts.md",
    "agoda-psp-routing.md",
    "agoda-reconciliation.md",
    "postgres-notes.md",
    "nodusart-advisory.md",
    "career-notes.md",
]

TAGLINE = "Payments engineer. Eleven years, four employers, one gap I'll tell you about."


def assert_success(response: httpx.Response) -> None:
    """Surface the most common local E2E configuration error without a long traceback."""

    if response.status_code == httpx.codes.UNAUTHORIZED:
        pytest.fail(
            "E2E request was unauthorized. Ensure the API_KEY pytest uses matches the "
            "one the gateway started with; `make test-e2e` loads both from .env.",
            pytrace=False,
        )
    response.raise_for_status()


@pytest.fixture(scope="module")
def source_text() -> str:
    """The fixture corpus, joined the way the web app's joinCorpus joins it.

    The per-file header is what the graph splits on, so building the corpus this way is
    what makes the read loop run seven times here rather than once — which is the only
    reason the status stream has seven READING lines to assert.
    """

    parts = []
    for name in FIXTURE_FILES:
        with open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
            parts.append(f"# SOURCE FILE: {name}\n\n{handle.read()}")
    return "\n\n---\n\n".join(parts)


@pytest.fixture(scope="module")
def expected() -> dict:
    with open(os.path.join(FIXTURES, "expected.json"), encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture
def client() -> httpx.Client:
    with httpx.Client(base_url=GATEWAY_URL, headers=HEADERS, timeout=30) as client:
        yield client


def section_ids(knowledge_base: dict) -> set[str]:
    """The ids every chip and quiz item must resolve against. Mirrors SectionID in Go."""

    ids = set()
    for section in knowledge_base["sections"]:
        anchor = section.get("anchor", "")
        ids.add(f"{section['path']}#{anchor}" if anchor else section["path"])
    return ids


def ingest(client: httpx.Client, source_text: str, title: str) -> tuple[str, list[dict]]:
    """Run one ingestion, collecting the server-sent events as they arrive.

    Reading the stream rather than polling is deliberate: this is exactly what the
    ingestion panel does, and it is where a broken SSE frame would show up.
    """

    events: list[dict] = []
    with client.stream(
        "POST",
        "/v1/knowledge-bases/ingest",
        json={
            "title": title,
            "tagline": TAGLINE,
            "source_text": source_text,
            "source_files": FIXTURE_FILES,
        },
        timeout=INGEST_TIMEOUT_SECONDS,
    ) as response:
        assert_success(response)
        assert response.headers["content-type"].startswith("text/event-stream")
        for line in response.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: ") :]))

    assert events, "the stream produced nothing"
    return events[0]["kb_id"], events


def test_ingestion_streams_and_persists_a_knowledge_base(
    client: httpx.Client, source_text: str, expected: dict
) -> None:
    kb_id, events = ingest(client, source_text, "Arun Velasco")

    # Frame order is the contract lib/api-client.ts parses: the draft id first, so a
    # client that sees nothing else still knows what to retry.
    assert events[0]["type"] == "draft"
    assert events[-1]["type"] == "result", f"run did not finish: {events[-1]}"

    status_lines = [event["message"] for event in events if event["type"] == "status"]
    assert any("READING" in line for line in status_lines), status_lines
    # One line per section, which is only possible because each section is its own
    # activity. Seeing them here proves the activity → signal → query → SSE path is live
    # rather than backfilled at the end.
    assert sum(1 for line in status_lines if line.startswith("WRITING SECTION")) >= 8
    assert any(line.startswith("DRAFTING OPENING QUESTIONS") for line in status_lines)
    assert any(line.startswith("WRITING THE GATE QUIZ") for line in status_lines)

    response = client.get(f"/v1/knowledge-bases/{kb_id}")
    assert_success(response)
    body = response.json()["knowledge_base"]

    assert body["ingest_status"] == "ready"
    assert body["status"] == "draft"
    assert len(body["sections"]) == len(expected["sections"])
    assert [section["ord"] for section in body["sections"]] == list(
        range(1, len(body["sections"]) + 1)
    )
    assert len(body["chips"]) == len(expected["chips"])
    assert len(body["quiz"]) == len(expected["quiz"])
    assert len(body["pre_roll"]["bullets"]) == 4
    # Kept so a retry never asks the candidate to find their documents again.
    assert body["source_text"]


def test_every_reference_survives_the_round_trip(client: httpx.Client, source_text: str) -> None:
    """Assertion B2 across all three languages at once.

    The ids are minted in Python, cross Temporal's payload converter, are persisted by
    Go into two different tables, and come back out as JSON the browser parses. A
    renamed tag anywhere on that path breaks here and nowhere else.
    """

    kb_id, _ = ingest(client, source_text, "Reference Check")
    body = client.get(f"/v1/knowledge-bases/{kb_id}").json()["knowledge_base"]
    ids = section_ids(body)

    dangling_chips = [chip["text"] for chip in body["chips"] if chip["kb_section"] not in ids]
    assert dangling_chips == [], f"chips citing nothing: {dangling_chips}"

    dangling_quiz = [item["id"] for item in body["quiz"] if item["source_section"] not in ids]
    assert dangling_quiz == [], f"quiz items citing nothing: {dangling_quiz}"


def test_the_quiz_can_actually_gate_a_booking(client: httpx.Client, source_text: str) -> None:
    """The gate samples one item per category and needs all four right.

    Four choices per item and a full set of categories is what makes that possible, so
    it is checked on the persisted payload rather than trusted from the pipeline.
    """

    kb_id, _ = ingest(client, source_text, "Gate Check")
    quiz = client.get(f"/v1/knowledge-bases/{kb_id}").json()["knowledge_base"]["quiz"]

    categories = {"motivation", "judgement", "limits", "substance"}
    assert {item["category"] for item in quiz} == categories

    for item in quiz:
        assert len(item["choices"]) == 4, item["id"]
        assert 0 <= item["correct_index"] < 4, item["id"]
        assert all(choice.strip() for choice in item["choices"]), item["id"]


def test_a_stranger_never_receives_the_quiz(client: httpx.Client, source_text: str) -> None:
    """The withholding rule, asserted on the bytes and without a session.

    Journey 2's /k/:slug page is unauthenticated by definition, so this projection is
    the only thing between a stranger and the answer key to the gate that protects
    twenty minutes of the candidate's real time.
    """

    kb_id, _ = ingest(client, source_text, "Withholding Check")

    with httpx.Client(base_url=GATEWAY_URL, headers=HEADERS, timeout=30) as anonymous:
        # No candidate header at all: the public audience needs no identity.
        response = anonymous.get(
            f"/v1/knowledge-bases/{kb_id}?audience=public",
            headers={"X-Candidate-Id": ""},
        )
    assert_success(response)

    payload = response.text
    public = response.json()["knowledge_base"]

    # Three chips reach the page — the ones the candidate chose — and nothing else.
    assert len(public["chips"]) == 3
    assert public["chips"][0]["text"]
    assert public["pre_roll"]["bullets"]

    # Keys, not substrings. A section summary legitimately contains the word "quiz",
    # and a naive `"quiz" not in payload` would fail on that — a test that cries wolf
    # about the one rule nobody can afford to start ignoring.
    for withheld in (
        "quiz",
        "correct_index",
        "choices",
        "rationale",
        "why_it_lands",
        "kb_section",
        "body_md",
        "source_text",
        "source_files",
        "candidate_id",
    ):
        assert f'"{withheld}":' not in payload, f"the public projection leaked {withheld}"

    # And the values, which is what actually matters. These come from the knowledge base
    # this test just created, so they are certain to be in the private copy.
    private = client.get(f"/v1/knowledge-bases/{kb_id}").json()["knowledge_base"]
    assert private["sections"][0]["body_md"] not in payload
    assert private["chips"][0]["why_it_lands"] not in payload
    # The answer key, in the form that would actually give the gate away.
    correct = private["quiz"][0]["choices"][private["quiz"][0]["correct_index"]]
    assert correct not in payload


def test_edit_publish_and_the_shareable_link(client: httpx.Client, source_text: str) -> None:
    kb_id, _ = ingest(client, source_text, "Publish Check")

    # A reorder from the knowledge-base tab: the right order, the wrong numbers.
    current = client.get(f"/v1/knowledge-bases/{kb_id}").json()["knowledge_base"]
    reordered = list(reversed(current["sections"]))
    patched = client.patch(
        f"/v1/knowledge-bases/{kb_id}",
        json={"sections": reordered, "title": "Publish Check, Edited"},
    )
    assert_success(patched)
    saved = patched.json()["knowledge_base"]
    assert saved["title"] == "Publish Check, Edited"
    assert [section["ord"] for section in saved["sections"]] == list(
        range(1, len(saved["sections"]) + 1)
    )
    assert saved["sections"][0]["title"] == reordered[0]["title"]
    # A sections-only reorder must not disturb the quiz sitting in a JSONB column.
    assert len(saved["quiz"]) == len(current["quiz"])

    published = client.post(f"/v1/knowledge-bases/{kb_id}/publish")
    assert_success(published)
    assert published.json()["knowledge_base"]["status"] == "published"
    assert published.json()["url"].startswith("/k/")

    # The edit survived Postgres, not just the response body.
    stored = client.get(f"/v1/knowledge-bases/{kb_id}").json()["knowledge_base"]
    assert stored["status"] == "published"


def test_publishing_an_unfinished_knowledge_base_reports_every_blocker(
    client: httpx.Client, source_text: str
) -> None:
    kb_id, _ = ingest(client, source_text, "Blocked Check")
    # Strip it back to something unpublishable, the way a candidate deleting the last
    # section and deselecting a question would.
    current = client.get(f"/v1/knowledge-bases/{kb_id}").json()["knowledge_base"]
    chips = [{**chip, "selected": False} for chip in current["chips"]]
    assert_success(
        client.patch(f"/v1/knowledge-bases/{kb_id}", json={"sections": [], "chips": chips})
    )

    response = client.post(f"/v1/knowledge-bases/{kb_id}/publish")

    assert response.status_code == httpx.codes.CONFLICT
    error = response.json()["error"]
    assert error["code"] == "not_publishable"
    # One round trip, every problem: no sections *and* no front page.
    assert len(error["blockers"]) >= 2


def test_rephrase_rewrites_a_chip_through_the_workflow(
    client: httpx.Client, source_text: str
) -> None:
    """No model client lives in Go: the rewrite is a Temporal workflow, which is also
    why the fixture model covers this button."""

    kb_id, _ = ingest(client, source_text, "Rephrase Check")
    before = client.get(f"/v1/knowledge-bases/{kb_id}").json()["knowledge_base"]["chips"][0]

    response = client.post(
        f"/v1/knowledge-bases/{kb_id}/chips/0/rephrase?register=blunt", timeout=90
    )
    assert_success(response)

    after = response.json()["knowledge_base"]["chips"][0]
    assert after["text"] != before["text"]
    assert after["register"] == "blunt"
    # Rewriting the question must not disturb what the candidate decided about it.
    assert after["selected"] == before["selected"]
    assert after["kb_section"] == before["kb_section"]


def test_retry_reuses_the_stored_source_text(client: httpx.Client, source_text: str) -> None:
    """The whole reason the draft is written before the pipeline runs."""

    kb_id, _ = ingest(client, source_text, "Retry Check")

    events: list[dict] = []
    with client.stream(
        "POST", f"/v1/knowledge-bases/{kb_id}/reingest", timeout=INGEST_TIMEOUT_SECONDS
    ) as response:
        assert_success(response)
        for line in response.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: ") :]))

    assert events[-1]["type"] == "result", f"retry did not finish: {events[-1]}"
    stored = client.get(f"/v1/knowledge-bases/{kb_id}").json()["knowledge_base"]
    assert stored["ingest_status"] == "ready"


def test_another_user_cannot_reach_the_knowledge_base(
    client: httpx.Client, source_text: str
) -> None:
    kb_id, _ = ingest(client, source_text, "Ownership Check")

    with httpx.Client(base_url=GATEWAY_URL, timeout=30) as other:
        response = other.get(
            f"/v1/knowledge-bases/{kb_id}",
            headers={**HEADERS, "X-Candidate-Id": "user-priya"},
        )

    assert response.status_code == httpx.codes.FORBIDDEN


def test_the_web_app_proxies_to_the_gateway() -> None:
    """The BFF hop. The browser is same-origin and never holds the API key, so a broken
    proxy is invisible to every gateway-level assertion above."""

    with httpx.Client(base_url=WEB_URL, timeout=30) as web:
        response = web.get("/api/kb")

    assert response.status_code == httpx.codes.OK
    # No credentials were sent from here: the proxy added them.
    assert "knowledge_bases" in response.json()


def test_a_closed_connection_does_not_lose_a_finished_run(
    client: httpx.Client, source_text: str
) -> None:
    """The candidate is told not to close the tab. A closed tab must still not cost them
    their work: the gateway persists from a watcher that outlives the request."""

    kb_id = None
    with client.stream(
        "POST",
        "/v1/knowledge-bases/ingest",
        json={
            "title": "Closed Tab Check",
            "tagline": TAGLINE,
            "source_text": source_text,
            "source_files": FIXTURE_FILES,
        },
        timeout=INGEST_TIMEOUT_SECONDS,
    ) as response:
        assert_success(response)
        for line in response.iter_lines():
            if line.startswith("data: "):
                kb_id = json.loads(line[len("data: ") :])["kb_id"]
                break  # hang up immediately, as closing the tab would

    assert kb_id

    deadline = time.monotonic() + INGEST_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        stored = client.get(f"/v1/knowledge-bases/{kb_id}").json()["knowledge_base"]
        if stored["ingest_status"] == "ready":
            assert stored["sections"], "marked ready with nothing in it"
            return
        assert stored["ingest_status"] != "failed", stored.get("ingest_error")
        time.sleep(2)

    pytest.fail(f"{kb_id} never finished after the client hung up")
