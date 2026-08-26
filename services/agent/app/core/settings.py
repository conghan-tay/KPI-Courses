from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings.

    Every external dependency is configured here, so a future project can replace
    infrastructure without changing graph nodes or the Temporal workflow.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    # POC_UserJourney.md §0: "one model for ingestion (bigger, slower is fine), one for
    # chat (fast)". Journey 1 only needs the first.
    model_provider: Literal["openai", "anthropic", "google", "fake"] = "anthropic"
    model_name: str = "claude-opus-5"
    model_temperature: float | None = None

    # Temporal owns durability and retries. There is no application database in this
    # process: the gateway persists the result, and the workflow event history is what
    # makes a run survive a worker restart.
    temporal_address: str = "localhost:7233"
    temporal_namespace: str = "default"
    temporal_task_queue: str = "course-ingest"
    temporal_api_key: str = ""
    temporal_tls: bool = False

    # Where docs/productDocs/fixtures lives, for MODEL_PROVIDER=fake. The container
    # copies it in; locally the default resolves from the repository root.
    fixture_dir: str = "docs/productDocs/fixtures"

    # A corpus larger than this is a paste bomb, not a course. Mirrors MaxSourceChars in
    # services/gateway/internal/api/types.go.
    max_source_chars: int = Field(default=400_000, ge=1_000, le=2_000_000)
    # How much of one source file goes into a single read. Long enough for the fixture's
    # longest part, short enough that a 180k-word corpus does not arrive in one prompt.
    max_segment_chars: int = Field(default=60_000, ge=1_000, le=400_000)
    # POC_UserJourney.md: "5–9 lessons". Enforced in code as well as in the prompt, so a
    # model that returns fifteen cannot produce a syllabus nobody would finish.
    max_lessons: int = Field(default=9, ge=1, le=20)
    # Fixture assertion A7: 5–8 positions is the expected range; above 9 you are
    # extracting craft as opinion.
    max_positions: int = Field(default=8, ge=1, le=20)
    # One repair pass over unanchored quotes. A second one has never found anything the
    # first did not, and it doubles the cost of the slowest failure mode.
    max_quote_repairs: int = Field(default=1, ge=0, le=3)

    @model_validator(mode="after")
    def reject_demo_production_configuration(self) -> "Settings":
        if self.environment == "production" and self.model_provider == "fake":
            raise ValueError("the fixture model is not allowed in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
