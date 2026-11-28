from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SUPPORTED_GROQ_VISION_MODEL = "qwen/qwen3.8-27b"
DEFAULT_GROQ_TEXT_MODEL = "openai/gpt-oss-20b"
DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5"
SUPPORTED_AI_PROVIDERS = ("gemini", "groq", "claude")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ai_provider: str = "groq"
    allow_server_ai_key_fallback: bool = False

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_model_fallbacks: str = "gemini-2.0-flash, gemini-1.5-flash, gemini-1.5-pro"
    gemini_max_retries: int = 2
    gemini_request_timeout: int = 60

    groq_api_key: str = ""
    groq_vision_model: str = SUPPORTED_GROQ_VISION_MODEL
    groq_vision_reasoning_effort: str = "none"
    groq_text_model: str = DEFAULT_GROQ_TEXT_MODEL
    groq_max_retries: int = 2
    groq_request_timeout: int = 30

    anthropic_api_key: str = ""
    claude_vision_model: str = DEFAULT_CLAUDE_MODEL
    claude_text_model: str = DEFAULT_CLAUDE_MODEL
    claude_max_retries: int = 2
    claude_request_timeout: int = 90

    analysis_lease_seconds: int = 300
    analysis_max_attempts: int = 3
    pending_item_retention_hours: int = 168
    notion_sync_lease_seconds: int = 300
    # One video per listing (Facebook Marketplace's separate "Add video" slot).
    max_video_upload_mb: int = 100

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "images"
    firebase_service_account_json: str = ""
    firebase_service_account_path: str = ""
    database_url: str = "postgresql://user:password@localhost:5432/db"
    cors_origins: str = "http://localhost:8081,exp://localhost:8081"
    notion_api_key: str = ""
    notion_database_id: str = ""
    notion_data_source_id: str = ""
    notion_api_version: str = "2026-03-11"
    notion_create_entries: bool = False
    notion_allow_client_override: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        if "*" in origins:
            raise ValueError("CORS_ORIGINS cannot contain '*' when credentialed requests are enabled")
        return origins

    @property
    def fallback_model_list(self) -> list[str]:
        return [m.strip() for m in self.gemini_model_fallbacks.split(",") if m.strip()]

    @field_validator("groq_vision_model")
    @classmethod
    def validate_groq_vision_model(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("GROQ_VISION_MODEL cannot be blank")
        if value != value.strip():
            raise ValueError("GROQ_VISION_MODEL cannot contain surrounding whitespace")
        if value != SUPPORTED_GROQ_VISION_MODEL:
            raise ValueError(f"GROQ_VISION_MODEL must be {SUPPORTED_GROQ_VISION_MODEL!r}")
        return value

    @field_validator("groq_vision_reasoning_effort")
    @classmethod
    def validate_groq_vision_reasoning_effort(cls, value: str) -> str:
        if value != value.strip():
            raise ValueError("GROQ_VISION_REASONING_EFFORT cannot contain surrounding whitespace")
        if value not in {"none", "default"}:
            raise ValueError("GROQ_VISION_REASONING_EFFORT must be 'none' or 'default'")
        return value

    @field_validator(
        "analysis_lease_seconds",
        "analysis_max_attempts",
        "pending_item_retention_hours",
        "notion_sync_lease_seconds",
        "max_video_upload_mb",
    )
    @classmethod
    def validate_positive_processing_settings(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("Processing lease and retention settings must be positive")
        return value


settings = Settings()
