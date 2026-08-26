"""The model seam.

One small domain interface with a method per pipeline step, so the graph is written
against "read this source" rather than against a vendor SDK. Two implementations:

  LangChainIngestionModel  the real thing, provider-neutral via init_chat_model
  FixtureIngestionModel    replays docs/productDocs/fixtures/expected.json

The fixture model is what makes CI and the browser smoke deterministic and free. It is
an oracle, not a simulation: it answers each step with the reference output rather than
reasoning. That is exactly what you want for testing the plumbing, and exactly what you
must not mistake for testing the extraction — the fixture's traps (A3–A6) are claims
about a *model's* judgement, and only an eval against a real model can check them. See
services/agent/tests/test_ingest_eval.py.
"""

import json
from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path
from typing import Any

from langchain.chat_models import init_chat_model

from ..graph import prompts
from .course_schemas import (
    CandidateClaim,
    Lesson,
    LessonPlan,
    LessonPlanSet,
    Position,
    PositionSet,
    Segment,
    SegmentReading,
    SourceKind,
    VoiceCard,
)
from .settings import Settings


class IngestionModel(ABC):
    """What the graph needs a model to be able to do, and nothing else."""

    @abstractmethod
    async def read_segment(
        self,
        segment: Segment,
        specialist_name: str,
        index: int,
        total: int,
        seen_summaries: list[str],
    ) -> SegmentReading: ...

    @abstractmethod
    async def resolve_positions(
        self, candidates: list[CandidateClaim], specialist_name: str
    ) -> PositionSet: ...

    @abstractmethod
    async def repair_quotes(self, positions: list[Position], source_text: str) -> PositionSet: ...

    @abstractmethod
    async def plan_lessons(
        self,
        specialist_name: str,
        title: str,
        tagline: str,
        summaries: list[str],
        craft_points: list[str],
        position_claims: list[str],
    ) -> LessonPlanSet: ...

    @abstractmethod
    async def write_lesson(
        self, plan: LessonPlan, position: int, total: int, material: str, voice_hint: str
    ) -> Lesson: ...

    @abstractmethod
    async def read_voice(self, specialist_name: str, excerpts: list[str]) -> VoiceCard: ...

    @abstractmethod
    async def soften_claim(self, claim: str) -> str: ...


class LangChainIngestionModel(IngestionModel):
    """Provider-neutral adapter using LangChain structured output."""

    def __init__(self, settings: Settings) -> None:
        provider_names = {"openai": "openai", "anthropic": "anthropic", "google": "google_genai"}
        options: dict[str, Any] = {}
        if settings.model_temperature is not None:
            options["temperature"] = settings.model_temperature
        self._model = init_chat_model(
            model=settings.model_name,
            model_provider=provider_names[settings.model_provider],
            **options,
        )

    async def _structured(self, schema: type, system: str, user: str) -> Any:
        model = self._model.with_structured_output(schema)
        return await model.ainvoke([("system", system), ("human", user)])

    async def read_segment(
        self,
        segment: Segment,
        specialist_name: str,
        index: int,
        total: int,
        seen_summaries: list[str],
    ) -> SegmentReading:
        return await self._structured(
            SegmentReading,
            prompts.READ_SEGMENT_SYSTEM,
            prompts.read_segment_prompt(segment, specialist_name, index, total, seen_summaries),
        )

    async def resolve_positions(
        self, candidates: list[CandidateClaim], specialist_name: str
    ) -> PositionSet:
        return await self._structured(
            PositionSet,
            prompts.RESOLVE_POSITIONS_SYSTEM,
            prompts.resolve_positions_prompt(candidates, specialist_name),
        )

    async def repair_quotes(self, positions: list[Position], source_text: str) -> PositionSet:
        listing = "\n".join(
            f"{index + 1}. {position.claim}" for index, position in enumerate(positions)
        )
        user = f"Positions needing an anchor:\n{listing}\n\n<source>\n{source_text}\n</source>"
        return await self._structured(PositionSet, prompts.REPAIR_QUOTES_SYSTEM, user)

    async def plan_lessons(
        self,
        specialist_name: str,
        title: str,
        tagline: str,
        summaries: list[str],
        craft_points: list[str],
        position_claims: list[str],
    ) -> LessonPlanSet:
        return await self._structured(
            LessonPlanSet,
            prompts.PLAN_LESSONS_SYSTEM,
            prompts.plan_lessons_prompt(
                specialist_name, title, tagline, summaries, craft_points, position_claims
            ),
        )

    async def write_lesson(
        self, plan: LessonPlan, position: int, total: int, material: str, voice_hint: str
    ) -> Lesson:
        return await self._structured(
            Lesson,
            prompts.WRITE_LESSON_SYSTEM,
            prompts.write_lesson_prompt(
                plan.title, plan.objective, position, total, material, voice_hint
            ),
        )

    async def read_voice(self, specialist_name: str, excerpts: list[str]) -> VoiceCard:
        return await self._structured(
            VoiceCard,
            prompts.VOICE_CARD_SYSTEM,
            prompts.voice_card_prompt(specialist_name, excerpts),
        )

    async def soften_claim(self, claim: str) -> str:
        result = await self._structured(PositionSet, prompts.SOFTEN_CLAIM_SYSTEM, f"Claim: {claim}")
        return result.positions[0].claim if result.positions else claim


@lru_cache
def _load_fixture(fixture_dir: str) -> dict[str, Any]:
    path = Path(fixture_dir) / "expected.json"
    return json.loads(path.read_text(encoding="utf-8"))


class FixtureIngestionModel(IngestionModel):
    """Replays the reference ingestion, one step at a time.

    Every method answers from docs/productDocs/fixtures/expected.json, so a run through
    the whole graph produces exactly the reference course without an API key and without
    a second of latency. The e2e stack and the Playwright smoke both depend on that.
    """

    def __init__(self, fixture_dir: str) -> None:
        self.fixture_dir = fixture_dir
        self._fixture = _load_fixture(fixture_dir)

    @property
    def _positions(self) -> list[Position]:
        return [Position.model_validate(row) for row in self._fixture["positions"]]

    @property
    def _lessons(self) -> list[Lesson]:
        return [Lesson.model_validate(row) for row in self._fixture["lessons"]]

    async def read_segment(
        self,
        segment: Segment,
        specialist_name: str,
        index: int,
        total: int,
        seen_summaries: list[str],
    ) -> SegmentReading:
        # The fixture's positions are spread across the segments round-robin, so that a
        # multi-file corpus produces candidates from more than one read and the loop is
        # genuinely exercised rather than short-circuited on the first file.
        positions = self._positions
        mine = [
            CandidateClaim(
                claim=position.claim,
                quote=position.quote,
                source_name=segment.name,
                source_kind=SourceKind.MANUSCRIPT,
            )
            for offset, position in enumerate(positions)
            if total > 0 and offset % total == index
        ]
        craft = [
            point for lesson in self._lessons[index :: max(total, 1)] for point in lesson.key_points
        ]
        return SegmentReading(
            kind=SourceKind.MANUSCRIPT,
            summary=f"{segment.name}: {segment.text[:120].strip()}",
            candidates=mine,
            craft_points=craft,
        )

    async def resolve_positions(
        self, candidates: list[CandidateClaim], specialist_name: str
    ) -> PositionSet:
        return PositionSet(positions=self._positions)

    async def repair_quotes(self, positions: list[Position], source_text: str) -> PositionSet:
        # Every quote in the fixture is anchored, so this is only ever reached when a
        # test has deliberately broken one. Answering with the reference quotes is what
        # lets that test assert the repair path put a real anchor back.
        by_claim = {position.claim: position for position in self._positions}
        return PositionSet(
            positions=[by_claim.get(position.claim, position) for position in positions]
        )

    async def plan_lessons(
        self,
        specialist_name: str,
        title: str,
        tagline: str,
        summaries: list[str],
        craft_points: list[str],
        position_claims: list[str],
    ) -> LessonPlanSet:
        return LessonPlanSet(
            lessons=[
                LessonPlan(title=lesson.title, objective=lesson.objective)
                for lesson in self._lessons
            ]
        )

    async def write_lesson(
        self, plan: LessonPlan, position: int, total: int, material: str, voice_hint: str
    ) -> Lesson:
        lessons = self._lessons
        if 1 <= position <= len(lessons):
            return lessons[position - 1]
        return Lesson(title=plan.title, objective=plan.objective)

    async def read_voice(self, specialist_name: str, excerpts: list[str]) -> VoiceCard:
        return VoiceCard.model_validate(self._fixture["voice_card"])

    async def soften_claim(self, claim: str) -> str:
        # Deterministic, and it genuinely hedges rather than pretending to: the button
        # on the review screen is never dead, and it never claims a rewrite it did not
        # do. Two absolutes are worth catching because they are what "soften" is for.
        for absolute, hedged in (
            ("never", "rarely"),
            ("Never", "Rarely"),
            ("always", "usually"),
            ("Always", "Usually"),
        ):
            if absolute in claim:
                return claim.replace(absolute, hedged, 1)
        return f"In most cases, {claim[0].lower()}{claim[1:]}" if claim else claim


def build_ingestion_model(settings: Settings) -> IngestionModel:
    if settings.model_provider == "fake":
        return FixtureIngestionModel(settings.fixture_dir)
    return LangChainIngestionModel(settings)
