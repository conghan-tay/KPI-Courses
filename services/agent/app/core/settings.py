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

    # POC_UserJourney.md §0: one model for ingestion, bigger and slower being fine. The
    # chat model is Journey 2's problem.
    model_provider: Literal["openai", "anthropic", "google", "fake"] = "anthropic"
    model_name: str = "claude-opus-5"
    model_temperature: float | None = None

    # Temporal owns durability and retries. There is no application database in this
    # process: the gateway persists the result, and the workflow event history is what
    # makes a run survive a worker restart.
    temporal_address: str = "localhost:7233"
    temporal_namespace: str = "default"
    temporal_task_queue: str = "kb-ingest"
    temporal_api_key: str = ""
    temporal_tls: bool = False

    # Where docs/productDocs/fixtures lives, for MODEL_PROVIDER=fake. The container
    # copies it in; locally the default resolves from the repository root.
    fixture_dir: str = "docs/productDocs/fixtures"

    # A corpus larger than this is a paste bomb, not a knowledge base. Mirrors
    # MaxSourceChars in services/gateway/internal/api/types.go.
    max_source_chars: int = Field(default=400_000, ge=1_000, le=2_000_000)
    # How much of one document goes into a single read. Long enough for the fixture's
    # longest write-up, short enough that a 180k-word corpus does not arrive in one
    # prompt.
    max_segment_chars: int = Field(default=60_000, ge=1_000, le=400_000)
    # POC_UserJourney.md asks the planner for 8–16 sections. Capped in code as well as in
    # the prompt, so a model that returns forty cannot produce a knowledge base nobody
    # reads. The fixture has 14.
    max_sections: int = Field(default=16, ge=1, le=40)
    # Fixture assertion B6: eight chips generated, three selected.
    max_chips: int = Field(default=8, ge=1, le=24)
    # Fixture assertion B7: twelve items, three per category.
    max_quiz_items: int = Field(default=12, ge=4, le=40)
    # pre_roll_wireframe.txt is drawn for four bullets. More and the card stops being a
    # pre-roll and starts being a page.
    pre_roll_bullets: int = Field(default=4, ge=1, le=8)
    # One repair pass over unresolved section references. A second has never found
    # anything the first did not, and it doubles the cost of the slowest failure mode.
    max_ref_repairs: int = Field(default=1, ge=0, le=3)

    @model_validator(mode="after")
    def reject_demo_production_configuration(self) -> "Settings":
        if self.environment == "production" and self.model_provider == "fake":
            raise ValueError("the fixture model is not allowed in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
