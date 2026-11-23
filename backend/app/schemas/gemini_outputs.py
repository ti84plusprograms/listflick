"""Internal schemas for validating raw Gemini JSON responses."""

from pydantic import BaseModel, Field, field_validator

from app.utils.json_parser import coerce_float, coerce_str_list, normalize_unknown



class GeminiDescriptionSections(BaseModel):
    opening: str = ""
    features: list[str] = Field(default_factory=list)
    condition_details: str = ""
    pickup_details: list[str] = Field(default_factory=list)
    closing: str = ""

    @field_validator("opening", "condition_details", "closing", mode="before")
    @classmethod
    def _normalize_text(cls, value: object) -> str:
        return str(value or "").strip()

    @field_validator("features", "pickup_details", mode="before")
    @classmethod
    def _normalize_lines(cls, value: object) -> list[str]:
        return [item.strip() for item in coerce_str_list(value) if item.strip()]


class GeminiListingOutput(BaseModel):
    title: str = ""
    description: str = ""
    description_sections: GeminiDescriptionSections | None = None
    tags: list[str] = Field(default_factory=list)
    marketplace_category: str = ""
    price_suggestion: dict = Field(default_factory=dict)

    @field_validator("title", "description", "marketplace_category", mode="before")
    @classmethod
    def _normalize_strings(cls, v: object) -> str:
        if v is None:
            return ""
        return str(v).strip()

    @field_validator("tags", mode="before")
    @classmethod
    def _normalize_lists(cls, v: object) -> list[str]:
        return coerce_str_list(v)


