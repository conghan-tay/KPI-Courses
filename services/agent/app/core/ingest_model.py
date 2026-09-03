"""The model seam.

One small domain interface with a method per pipeline step, so the graph is written
against "read this document" rather than against a vendor SDK. Two implementations:

  LangChainIngestionModel  the real thing, provider-neutral via init_chat_model
  FixtureIngestionModel    replays docs/productDocs/fixtures/expected.json

The fixture model is what makes CI and the browser smoke deterministic and free. It is
an oracle, not a simulation: it answers each step with the reference output rather than
reasoning. That is exactly what you want for testing the plumbing, and exactly what you
must not mistake for testing the extraction — the fixture's traps (B3, B5, B6, B7) are
claims about a *model's* judgement, and only an eval against a real model can check them.
See services/agent/tests/test_ingest_eval.py.
"""

import json
from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path
from typing import Any

from langchain.chat_models import init_chat_model

from ..graph import prompts
from .kb_schemas import (
    Chip,
    ChipRegister,
    ChipSet,
    PreRoll,
    QuizCategory,
    QuizItem,
    QuizSet,
    Section,
    SectionPlan,
    SectionPlanSet,
    Segment,
    SegmentReading,
    SourceKind,
)
from .settings import Settings

# Kinds for the reference corpus, so a fixture run classifies documents the way a real
# read would rather than labelling all seven `unknown`.
_FIXTURE_KINDS: dict[str, SourceKind] = {
    "resume.md": SourceKind.RESUME,
    "agoda-supplier-payouts.md": SourceKind.SYSTEM_WRITEUP,
    "agoda-psp-routing.md": SourceKind.SYSTEM_WRITEUP,
    "agoda-reconciliation.md": SourceKind.SYSTEM_WRITEUP,
    "postgres-notes.md": SourceKind.NOTES,
    "nodusart-advisory.md": SourceKind.NOTES,
    "career-notes.md": SourceKind.NOTES,
}


class IngestionModel(ABC):
    """What the graph needs a model to be able to do, and nothing else."""

    @abstractmethod
    async def read_segment(
        self,
        segment: Segment,
        candidate_name: str,
        index: int,
        total: int,
        seen_summaries: list[str],
    ) -> SegmentReading: ...

    @abstractmethod
    async def plan_sections(
        self,
        candidate_name: str,
        title: str,
        tagline: str,
        summaries: list[str],
        section_candidates: list[dict[str, Any]],
        facts: list[str],
        opinions: list[str],
        limits: list[str],
        motivations: list[str],
    ) -> SectionPlanSet: ...

    @abstractmethod
    async def write_section(
        self, plan: SectionPlan, position: int, total: int, material: str
    ) -> Section: ...

    @abstractmethod
    async def generate_chips(
        self, candidate_name: str, sections: list[dict[str, Any]]
    ) -> ChipSet: ...

    @abstractmethod
    async def generate_quiz(
        self,
        candidate_name: str,
        sections: list[dict[str, Any]],
        limits: list[str],
        motivations: list[str],
    ) -> QuizSet: ...

    @abstractmethod
    async def repair_refs(self, items: list[str], section_ids: list[str]) -> list[str]: ...

    @abstractmethod
    async def write_pre_roll(
        self, candidate_name: str, sections: list[dict[str, Any]]
    ) -> PreRoll: ...

    @abstractmethod
    async def rephrase_chip(self, text: str, register: ChipRegister) -> str: ...


class _RepairedRefs(ChipSet):
    """Structured-output carrier for the repair step.

    Reusing ChipSet keeps the schema the provider sees to one already-registered shape:
    the repairer is asked for `text` (the item it is fixing) and `kb_section` (the id it
    chose), and nothing else on the model is read.
    """


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
        candidate_name: str,
        index: int,
        total: int,
        seen_summaries: list[str],
    ) -> SegmentReading:
        return await self._structured(
            SegmentReading,
            prompts.READ_SEGMENT_SYSTEM,
            prompts.read_segment_prompt(segment, candidate_name, index, total, seen_summaries),
        )

    async def plan_sections(
        self,
        candidate_name: str,
        title: str,
        tagline: str,
        summaries: list[str],
        section_candidates: list[dict[str, Any]],
        facts: list[str],
        opinions: list[str],
        limits: list[str],
        motivations: list[str],
    ) -> SectionPlanSet:
        return await self._structured(
            SectionPlanSet,
            prompts.PLAN_SECTIONS_SYSTEM,
            prompts.plan_sections_prompt(
                candidate_name,
                title,
                tagline,
                summaries,
                section_candidates,
                facts,
                opinions,
                limits,
                motivations,
            ),
        )

    async def write_section(
        self, plan: SectionPlan, position: int, total: int, material: str
    ) -> Section:
        return await self._structured(
            Section,
            prompts.WRITE_SECTION_SYSTEM,
            prompts.write_section_prompt(
                plan.path, plan.anchor, plan.title, plan.summary, position, total, material
            ),
        )

    async def generate_chips(self, candidate_name: str, sections: list[dict[str, Any]]) -> ChipSet:
        return await self._structured(
            ChipSet,
            prompts.GENERATE_CHIPS_SYSTEM,
            prompts.generate_chips_prompt(candidate_name, sections),
        )

    async def generate_quiz(
        self,
        candidate_name: str,
        sections: list[dict[str, Any]],
        limits: list[str],
        motivations: list[str],
    ) -> QuizSet:
        return await self._structured(
            QuizSet,
            prompts.GENERATE_QUIZ_SYSTEM,
            prompts.generate_quiz_prompt(candidate_name, sections, limits, motivations),
        )

    async def repair_refs(self, items: list[str], section_ids: list[str]) -> list[str]:
        listing = "\n".join(f"{index + 1}. {item}" for index, item in enumerate(items))
        available = "\n".join(f"- {section_id}" for section_id in section_ids)
        user = f"Items needing a source:\n{listing}\n\nReal section ids:\n{available}"
        repaired = await self._structured(_RepairedRefs, prompts.REPAIR_REFS_SYSTEM, user)
        # Matched by text rather than by position: the model is being asked for ids, and
        # trusting it to also preserve list order would be one silent reordering away from
        # attaching the wrong source to the wrong question.
        by_text = {chip.text: chip.kb_section for chip in repaired.chips}
        return [by_text.get(item, "") for item in items]

    async def write_pre_roll(self, candidate_name: str, sections: list[dict[str, Any]]) -> PreRoll:
        return await self._structured(
            PreRoll,
            prompts.PRE_ROLL_SYSTEM,
            prompts.pre_roll_prompt(candidate_name, sections),
        )

    async def rephrase_chip(self, text: str, register: ChipRegister) -> str:
        result = await self._structured(
            ChipSet,
            prompts.REPHRASE_CHIP_SYSTEM,
            f"Register: {register.value}\nQuestion: {text}",
        )
        return result.chips[0].text if result.chips else text


@lru_cache
def _load_fixture(fixture_dir: str) -> dict[str, Any]:
    path = Path(fixture_dir) / "expected.json"
    return json.loads(path.read_text(encoding="utf-8"))


class FixtureIngestionModel(IngestionModel):
    """Replays the reference ingestion, one step at a time.

    Every method answers from docs/productDocs/fixtures/expected.json, so a run through
    the whole graph produces exactly the reference knowledge base without an API key and
    without a second of latency. The e2e stack and the Playwright smoke both depend on
    that.
    """

    def __init__(self, fixture_dir: str) -> None:
        self.fixture_dir = fixture_dir
        self._fixture = _load_fixture(fixture_dir)

    @property
    def _sections(self) -> list[Section]:
        return [Section.model_validate(row) for row in self._fixture["sections"]]

    @property
    def _chips(self) -> list[Chip]:
        return [Chip.model_validate(row) for row in self._fixture["chips"]]

    @property
    def _quiz(self) -> list[QuizItem]:
        return [QuizItem.model_validate(row) for row in self._fixture["quiz"]]

    async def read_segment(
        self,
        segment: Segment,
        candidate_name: str,
        index: int,
        total: int,
        seen_summaries: list[str],
    ) -> SegmentReading:
        # The fixture's sections are dealt across the documents round-robin, so a
        # multi-file corpus produces candidates from more than one read and the loop is
        # genuinely exercised rather than short-circuited on the first document.
        mine = [
            section
            for offset, section in enumerate(self._sections)
            if total > 0 and offset % total == index
        ]
        return SegmentReading(
            kind=_FIXTURE_KINDS.get(segment.name, SourceKind.UNKNOWN),
            summary=f"{segment.name}: {segment.text[:120].strip()}",
            section_candidates=[
                {
                    "title": section.title,
                    "path_hint": section.path,
                    "anchor_hint": section.anchor,
                    "summary": section.summary,
                    "source_name": segment.name,
                }
                for section in mine
            ],
            facts=[section.summary for section in mine],
            # Spread the quiz's own material across the reads so `plan_sections` and
            # `generate_quiz` see non-empty accumulators, which is what the real run
            # would give them.
            opinions=self._quiz_slice(index, total, QuizCategory.SUBSTANCE),
            limits=self._quiz_slice(index, total, QuizCategory.LIMITS),
            motivations=self._quiz_slice(index, total, QuizCategory.MOTIVATION),
        )

    def _quiz_slice(self, index: int, total: int, category: QuizCategory) -> list[str]:
        return [
            item.question
            for item in self._quiz[index :: max(total, 1)]
            if item.category is category
        ]

    async def plan_sections(
        self,
        candidate_name: str,
        title: str,
        tagline: str,
        summaries: list[str],
        section_candidates: list[dict[str, Any]],
        facts: list[str],
        opinions: list[str],
        limits: list[str],
        motivations: list[str],
    ) -> SectionPlanSet:
        return SectionPlanSet(
            sections=[
                SectionPlan(
                    path=section.path,
                    anchor=section.anchor,
                    title=section.title,
                    summary=section.summary,
                    source_names=section.source_names,
                )
                for section in self._sections
            ]
        )

    async def write_section(
        self, plan: SectionPlan, position: int, total: int, material: str
    ) -> Section:
        by_id = {section.identifier(): section for section in self._sections}
        written = by_id.get(plan.identifier())
        if written is not None:
            return written
        return Section(path=plan.path, anchor=plan.anchor, title=plan.title, summary=plan.summary)

    async def generate_chips(self, candidate_name: str, sections: list[dict[str, Any]]) -> ChipSet:
        return ChipSet(chips=self._chips)

    async def generate_quiz(
        self,
        candidate_name: str,
        sections: list[dict[str, Any]],
        limits: list[str],
        motivations: list[str],
    ) -> QuizSet:
        return QuizSet(quiz=self._quiz)

    async def repair_refs(self, items: list[str], section_ids: list[str]) -> list[str]:
        # Every reference in the fixture resolves, so this is only ever reached when a
        # test has deliberately broken one. Answering from the reference data is what
        # lets that test assert the repair path put a real id back.
        known = {chip.text: chip.kb_section for chip in self._chips}
        known.update({item.question: item.source_section for item in self._quiz})
        return [known.get(item, "") for item in items]

    async def write_pre_roll(self, candidate_name: str, sections: list[dict[str, Any]]) -> PreRoll:
        return PreRoll.model_validate(self._fixture["pre_roll"])

    async def rephrase_chip(self, text: str, register: ChipRegister) -> str:
        # Deterministic, and it genuinely rewrites rather than pretending to: the button
        # on the review screen is never dead, and it never claims a rewrite it did not
        # do. The three forms are the three registers the prompt asks a real model for.
        stem = text.strip().rstrip("?").lower()
        if register is ChipRegister.SKEPTICAL:
            return f"how deep is {stem}, really?"
        if register is ChipRegister.BLUNT:
            return f"{stem} — straight answer?"
        return f"walk me through {stem}"


def build_ingestion_model(settings: Settings) -> IngestionModel:
    if settings.model_provider == "fake":
        return FixtureIngestionModel(settings.fixture_dir)
    return LangChainIngestionModel(settings)
