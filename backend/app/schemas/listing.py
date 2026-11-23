from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class PriceSuggestion(BaseModel):
    min: float = Field(default=0, ge=0)
    max: float = Field(default=0, ge=0)
    fast_sale_price: float = Field(default=0, ge=0)
    recommended_price: float = Field(default=0, ge=0)
    high_ask_price: float = Field(default=0, ge=0)
    confidence: float = Field(default=0.0, ge=0, le=1)
    pricing_reason: str = ""
    pricing_warnings: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _normalize_pricing(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value

        data = dict(value)

        def number(key: str) -> float:
            raw = data.get(key)
            try:
                return max(0.0, float(raw or 0))
            except (TypeError, ValueError):
                return 0.0

        raw_warnings = data.get("pricing_warnings") or []
        if isinstance(raw_warnings, str):
            warnings = [raw_warnings.strip()] if raw_warnings.strip() else []
        elif isinstance(raw_warnings, list):
            warnings = [str(item).strip() for item in raw_warnings if str(item).strip()]
        else:
            warnings = []

        data.update(
            {
                "min": number("min"),
                "max": number("max"),
                "fast_sale_price": number("fast_sale_price"),
                "recommended_price": number("recommended_price"),
                "high_ask_price": number("high_ask_price"),
                "confidence": min(1.0, max(0.0, number("confidence"))),
                "pricing_reason": str(data.get("pricing_reason") or "").strip(),
                "pricing_warnings": warnings,
            }
        )
        return data


class ChecklistItem(BaseModel):
    key: str
    label: str
    status: Literal["missing", "uncertain", "complete"]
    reason: str | None = None
    suggested_question: str | None = None


ImageQualityStatus = Literal["good", "needs_improvement", "poor"]


class ImageQualityFeedback(BaseModel):
    image_id: str = ""
    image_index: int = 0
    overall_status: ImageQualityStatus = "good"
    sharpness_status: ImageQualityStatus = "good"
    brightness_status: ImageQualityStatus = "good"
    contrast_status: ImageQualityStatus = "good"
    detail_status: ImageQualityStatus = "good"
    notes: list[str] = Field(default_factory=list)
    suggested_action: str = "Use this photo."


ReadinessLabel = Literal["needs_work", "almost_ready", "ready"]


class ListingQuality(BaseModel):
    overall_score: int = Field(default=0, ge=0, le=100)
    readiness_label: ReadinessLabel = "needs_work"
    score_breakdown: dict[str, int] = Field(default_factory=dict)
    improvement_suggestions: list[str] = Field(default_factory=list)


class VisionAnalysis(BaseModel):
    item_name: str = ""
    brand: str = ""
    condition: str = ""
    category: str = ""
    confidence: float = Field(default=0.0, ge=0, le=1)
    detected_attributes: list[str] = Field(default_factory=list)
    visible_defects: list[str] = Field(default_factory=list)
    suggested_price_min: float = Field(default=0.0, ge=0)
    suggested_price_max: float = Field(default=0.0, ge=0)

    @model_validator(mode="before")
    @classmethod
    def _normalize_fields(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value

        data = dict(value)

        for key in ["brand", "item_name", "category", "condition"]:
            val = str(data.get(key) or "").strip()
            if val.lower() in {"unknown", "n/a", "none"}:
                val = ""
            data[key] = val

        try:
            data["confidence"] = max(0.0, min(1.0, float(data.get("confidence") or 0.0)))
        except (TypeError, ValueError):
            data["confidence"] = 0.0

        for key in ["detected_attributes", "visible_defects"]:
            raw = data.get(key)
            if isinstance(raw, list):
                data[key] = [str(i).strip() for i in raw if str(i).strip()]
            elif isinstance(raw, str):
                data[key] = [raw.strip()] if raw.strip() else []
            else:
                data[key] = []

        return data


class GeneratedListing(BaseModel):
    title: str = ""
    description: str = ""
    marketplace_category: str = ""
    tags: list[str] = Field(default_factory=list)
    price_suggestion: PriceSuggestion = Field(default_factory=lambda: PriceSuggestion(min=0, max=0))
    listing_quality: ListingQuality = Field(default_factory=ListingQuality)


class UploadResponse(BaseModel):
    item_id: str
    image_url: str
    image_urls: list[str] = Field(default_factory=list)
    image_quality_feedback: list[ImageQualityFeedback] = Field(default_factory=list)
    status: Literal["uploading", "uploaded"] = "uploaded"


class TrashRequest(BaseModel):
    retention_days: Literal[7, 30, 90] = 30


class NotionSyncRequest(BaseModel):
    notion_sync_enabled: bool | None = None


class AnalyzeRequest(BaseModel):
    item_id: str


class AnalyzeResponse(BaseModel):
    item_id: str
    analysis: VisionAnalysis
    listing: GeneratedListing
    missing_checklist: list[ChecklistItem] = Field(default_factory=list)
    image_quality: dict[str, Any] = Field(default_factory=dict)
    image_quality_feedback: list[ImageQualityFeedback] = Field(default_factory=list)


AnalysisJobState = Literal[
    "queued",
    "processing",
    "succeeded",
    "retryable_failed",
    "terminal_failed",
]


class AnalysisJobStatus(BaseModel):
    item_id: str
    status: AnalysisJobState
    attempt_count: int = 0
    can_retry: bool = False
    last_error_code: str | None = None
    lease_expires_at: datetime | None = None


class AnalysisJobResponse(BaseModel):
    job: AnalysisJobStatus


class SaveListingRequest(BaseModel):
    title: str
    description: str
    category: str = ""
    condition: str = ""
    asking_price: float = Field(default=0, ge=0)
    notion_sync_enabled: bool | None = None


ImprovementAction = Literal[
    "make_title_more_searchable",
    "make_description_shorter",
    "make_description_more_casual",
    "make_description_more_professional",
    "add_condition_details",
    "improve_buyer_trust",
    "make_price_more_competitive",
    "generate_platform_ready_version",
]


class ImproveListingRequest(BaseModel):
    item_id: str | None = None
    listing: GeneratedListing | None = None
    analysis: VisionAnalysis | None = None
    action: ImprovementAction
    custom_instruction: str = Field(default="", max_length=600)


class ImproveListingResponse(BaseModel):
    item_id: str | None = None
    listing: GeneratedListing
    missing_checklist: list[ChecklistItem] = Field(default_factory=list)


class NotionSyncStatus(BaseModel):
    status: Literal["not_synced", "syncing", "synced", "failed"] = "not_synced"
    reason: Literal[
        "configured",
        "backend_disabled",
        "missing_credentials",
        "client_disabled",
    ] | None = None
    error_code: Literal[
        "timeout",
        "network",
        "tls",
        "rate_limited",
        "authorization",
        "schema",
        "not_found",
        "provider_rejected",
        "unknown",
    ] | None = None
    page_id: str | None = None
    page_url: str | None = None
    last_attempt_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None


class SaveListingResponse(BaseModel):
    item_id: str
    notion_page_id: str | None = None
    notion_synced: bool = False
    notion_sync: NotionSyncStatus = Field(default_factory=NotionSyncStatus)
    listing: GeneratedListing | None = None
    missing_checklist: list[ChecklistItem] = Field(default_factory=list)
    image_quality_feedback: list[ImageQualityFeedback] = Field(default_factory=list)


class ItemResponse(BaseModel):
    id: str
    image_url: str
    status: str
    analysis: VisionAnalysis | None = None
    listing: GeneratedListing | None = None
    missing_checklist: list[ChecklistItem] = Field(default_factory=list)
    image_quality_feedback: list[ImageQualityFeedback] = Field(default_factory=list)
    analysis_job: AnalysisJobStatus | None = None
    notion_sync: NotionSyncStatus = Field(default_factory=NotionSyncStatus)
    created_at: datetime
    updated_at: datetime


class ImageQualityError(BaseModel):
    detail: str
    issues: list[str]
    image_quality_feedback: list[ImageQualityFeedback] = Field(default_factory=list)
