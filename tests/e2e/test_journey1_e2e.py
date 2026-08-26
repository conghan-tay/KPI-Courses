"""Journey 1 against the running stack: raw material → published course.

This is the only test that exercises the cross-language contract for real. The Go
structs, the Pydantic models and the zod schemas agree by convention — a renamed JSON
tag surfaces as a workflow task failure or a client-side parse error, never as a compile
error — and this is what catches that.

It also covers the two things unit tests structurally cannot: that a durable run started
by one process is persisted by it after the model has finished, and that a retry works
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
    "X-Specialist-Id": "user-dana",
}
INGEST_TIMEOUT_SECONDS = 180

FIXTURES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "docs",
    "productDocs",
    "fixtures",
)


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
    with open(os.path.join(FIXTURES, "source.md"), encoding="utf-8") as handle:
        body = handle.read()
    # The per-file header the web app's joinCorpus writes. The graph splits the corpus
    # back apart on it, so sending it here is what makes this the same input the browser
    # would produce.
    return f"# SOURCE FILE: source.md\n\n{body}"


@pytest.fixture(scope="module")
def expected() -> dict:
    with open(os.path.join(FIXTURES, "expected.json"), encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture
def client() -> httpx.Client:
    with httpx.Client(base_url=GATEWAY_URL, headers=HEADERS, timeout=30) as client:
        yield client


def ingest(client: httpx.Client, source_text: str, title: str) -> tuple[str, list[dict]]:
    """Run one ingestion, collecting the server-sent events as they arrive.

    Reading the stream rather than polling is deliberate: this is exactly what the
    ingestion panel does, and it is where a broken SSE frame would show up.
    """

    events: list[dict] = []
    with client.stream(
        "POST",
        "/v1/courses/ingest",
        json={
            "title": title,
            "tagline": "The deal is won or lost long before anyone says a price.",
            "price_cents": 34900,
            "source_text": source_text,
            "source_files": ["source.md"],
        },
        timeout=INGEST_TIMEOUT_SECONDS,
    ) as response:
        assert_success(response)
        assert response.headers["content-type"].startswith("text/event-stream")
        for line in response.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: ") :]))

    assert events, "the stream produced nothing"
    return events[0]["course_id"], events


def test_ingestion_streams_and_persists_a_course(
    client: httpx.Client, source_text: str, expected: dict
) -> None:
    course_id, events = ingest(client, source_text, "Hold Your Number")

    # Frame order is the contract lib/api-client.ts parses: the draft id first, so a
    # client that sees nothing else still knows what to retry.
    assert events[0]["type"] == "draft"
    assert events[-1]["type"] == "result", f"run did not finish: {events[-1]}"

    status_lines = [event["message"] for event in events if event["type"] == "status"]
    assert any("READING" in line for line in status_lines), status_lines
    # One line per lesson, which is only possible because each lesson is its own
    # activity. Seeing them here proves the activity → signal → query → SSE path is live
    # rather than backfilled at the end.
    assert sum(1 for line in status_lines if line.startswith("WRITING LESSON")) >= 5

    course = client.get(f"/v1/courses/{course_id}")
    assert_success(course)
    body = course.json()["course"]

    assert body["ingest_status"] == "ready"
    assert body["status"] == "draft"
    assert len(body["lessons"]) == len(expected["lessons"])
    assert [lesson["ord"] for lesson in body["lessons"]] == list(range(1, len(body["lessons"]) + 1))
    assert body["positions"]
    assert body["voice_card"]["register"]
    # Kept so a retry never asks the Specialist to find their files again.
    assert body["source_text"]


def test_a_stranger_never_receives_the_argument(client: httpx.Client, source_text: str) -> None:
    """DESIGN.md §4.5, asserted on the bytes and without a session.

    Journey 2's course page is unauthenticated by definition, so this projection is the
    only thing standing between a stranger and the entire paid product.
    """

    course_id, _ = ingest(client, source_text, "Withholding Check")

    with httpx.Client(base_url=GATEWAY_URL, headers=HEADERS, timeout=30) as anonymous:
        # No specialist header at all: the public audience needs no identity.
        response = anonymous.get(
            f"/v1/courses/{course_id}?audience=public",
            headers={"X-Specialist-Id": ""},
        )
    assert_success(response)

    payload = response.text
    course = response.json()["course"]

    assert course["positions"][0]["claim"]

    # Keys, not substrings. A lesson objective legitimately reads "can scope, quote and
    # close a paid assessment", and a naive `"quote" not in payload` fails on that — a
    # test that cries wolf about the one rule nobody can afford to start ignoring.
    for withheld in (
        "because",
        "pushback",
        "quote",
        "body_md",
        "key_points",
        "source_text",
        "source_files",
        "voice_card",
        "specialist_id",
    ):
        assert f'"{withheld}":' not in payload, f"the public projection leaked {withheld}"

    # And the values, which is what actually matters. These come from the course this
    # test just created, so they are certain to be in the private copy.
    private = client.get(f"/v1/courses/{course_id}").json()["course"]
    assert private["positions"][0]["because"] not in payload
    assert private["lessons"][0]["body_md"] not in payload
    assert private["voice_card"]["register"] not in payload


def test_edit_publish_and_the_shareable_link(client: httpx.Client, source_text: str) -> None:
    course_id, _ = ingest(client, source_text, "Publish Check")

    # A reorder from the syllabus tab: the right order, the wrong numbers.
    current = client.get(f"/v1/courses/{course_id}").json()["course"]
    reordered = list(reversed(current["lessons"]))
    patched = client.patch(
        f"/v1/courses/{course_id}",
        json={"lessons": reordered, "title": "Publish Check, Edited"},
    )
    assert_success(patched)
    saved = patched.json()["course"]
    assert saved["title"] == "Publish Check, Edited"
    assert [lesson["ord"] for lesson in saved["lessons"]] == list(
        range(1, len(saved["lessons"]) + 1)
    )
    assert saved["lessons"][0]["title"] == reordered[0]["title"]

    published = client.post(f"/v1/courses/{course_id}/publish")
    assert_success(published)
    assert published.json()["course"]["status"] == "published"
    assert published.json()["url"].startswith("/c/")

    # The edit survived Postgres, not just the response body.
    assert client.get(f"/v1/courses/{course_id}").json()["course"]["status"] == "published"


def test_publishing_an_unfinished_course_reports_every_blocker(
    client: httpx.Client, source_text: str
) -> None:
    course_id, _ = ingest(client, source_text, "Blocked Check")
    # Strip it back to something unpublishable, the way a Specialist deleting the last
    # lesson would.
    assert_success(client.patch(f"/v1/courses/{course_id}", json={"lessons": []}))

    response = client.post(f"/v1/courses/{course_id}/publish")

    assert response.status_code == httpx.codes.CONFLICT
    error = response.json()["error"]
    assert error["code"] == "not_publishable"
    assert error["blockers"]


def test_soften_rewrites_a_claim_through_the_workflow(
    client: httpx.Client, source_text: str
) -> None:
    """No model client lives in Go: the rewrite is a Temporal workflow, which is also
    why the fixture model covers this button."""

    course_id, _ = ingest(client, source_text, "Soften Check")
    before = client.get(f"/v1/courses/{course_id}").json()["course"]["positions"][0]

    response = client.post(f"/v1/courses/{course_id}/positions/0/soften", timeout=90)
    assert_success(response)

    after = response.json()["course"]["positions"][0]
    assert after["claim"] != before["claim"]
    # Softening rewrites the hook. The argument is the Specialist's own words.
    assert after["because"] == before["because"]


def test_retry_reuses_the_stored_source_text(client: httpx.Client, source_text: str) -> None:
    """The whole reason the draft is written before the model runs."""

    course_id, _ = ingest(client, source_text, "Retry Check")

    events: list[dict] = []
    with client.stream(
        "POST", f"/v1/courses/{course_id}/reingest", timeout=INGEST_TIMEOUT_SECONDS
    ) as response:
        assert_success(response)
        for line in response.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: ") :]))

    assert events[-1]["type"] == "result", f"retry did not finish: {events[-1]}"
    assert client.get(f"/v1/courses/{course_id}").json()["course"]["ingest_status"] == "ready"


def test_another_specialist_cannot_reach_the_course(client: httpx.Client, source_text: str) -> None:
    course_id, _ = ingest(client, source_text, "Ownership Check")

    with httpx.Client(base_url=GATEWAY_URL, timeout=30) as other:
        response = other.get(
            f"/v1/courses/{course_id}",
            headers={**HEADERS, "X-Specialist-Id": "user-sam"},
        )

    assert response.status_code == httpx.codes.FORBIDDEN


def test_the_web_app_proxies_to_the_gateway() -> None:
    """The BFF hop. The browser is same-origin and never holds the API key, so a broken
    proxy is invisible to every gateway-level assertion above."""

    with httpx.Client(base_url=WEB_URL, timeout=30) as web:
        response = web.get("/api/courses")

    assert response.status_code == httpx.codes.OK
    # No credentials were sent from here: the proxy added them.
    assert "courses" in response.json()


def test_a_closed_connection_does_not_lose_a_finished_course(
    client: httpx.Client, source_text: str
) -> None:
    """The Specialist is told not to close the tab. A closed tab must still not cost
    them a course: the gateway persists from a watcher that outlives the request."""

    course_id = None
    with client.stream(
        "POST",
        "/v1/courses/ingest",
        json={
            "title": "Closed Tab Check",
            "tagline": "A line.",
            "price_cents": 34900,
            "source_text": source_text,
            "source_files": ["source.md"],
        },
        timeout=INGEST_TIMEOUT_SECONDS,
    ) as response:
        assert_success(response)
        for line in response.iter_lines():
            if line.startswith("data: "):
                course_id = json.loads(line[len("data: ") :])["course_id"]
                break  # hang up immediately, as closing the tab would

    assert course_id

    deadline = time.monotonic() + INGEST_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        course = client.get(f"/v1/courses/{course_id}").json()["course"]
        if course["ingest_status"] == "ready":
            assert course["lessons"], "marked ready with nothing in it"
            return
        assert course["ingest_status"] != "failed", course.get("ingest_error")
        time.sleep(2)

    pytest.fail(f"{course_id} never finished after the client hung up")
