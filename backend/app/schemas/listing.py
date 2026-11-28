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


MAX_QUESTION_OPTIONS = 4
MAX_BUYER_QUESTIONS = 3
MAX_STANDARD_SPECS = 8
STANDARD_SPECS_MIN_CONFIDENCE = 0.8


def _clean_str(value: object) -> str:
    return str(value or "").strip()


def _clean_options(value: object) -> list[str]:
    if isinstance(value, str):
        value = [part for part in value.split(",")]
    if not isinstance(value, list):
        return []
    options: list[str] = []
    seen: set[str] = set()
    for raw in value:
        text = _clean_str(raw)
        key = text.casefold()
        if not text or key in seen:
            continue
        seen.add(key)
        options.append(text)
    return options[:MAX_QUESTION_OPTIONS]


def _coerce_bool(value: object) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"true", "yes", "1"}
    return bool(value)


class PriceQuestion(BaseModel):
    """One unknown detail that would move the price by more than about 25%."""

    question: str = ""
    why: str = ""
    options: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, value: object) -> object:
        if isinstance(value, str):
            value = {"question": value}
        if not isinstance(value, dict):
            return value
        data = dict(value)
        data["question"] = _clean_str(data.get("question"))
        data["why"] = _clean_str(data.get("why"))
        data["options"] = _clean_options(data.get("options"))
        return data


class BuyerQuestion(BaseModel):
    """Something buyers of this kind of item always ask that the photos cannot answer."""

    question: str = ""
    options: list[str] = Field(default_factory=list)
    affects_price: bool = False

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, value: object) -> object:
        if isinstance(value, str):
            value = {"question": value}
        if not isinstance(value, dict):
            return value
        data = dict(value)
        data["question"] = _clean_str(data.get("question"))
        data["options"] = _clean_options(data.get("options"))
        data["affects_price"] = _coerce_bool(data.get("affects_price"))
        return data


def normalize_price_question(value: object) -> dict | None:
    """Return a clean price question dict, or None when the model did not ask a usable one."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str) and value.strip().lower() in {"", "null", "none", "n/a"}:
        return None
    try:
        question = PriceQuestion.model_validate(value)
    except Exception:
        return None
    return question.model_dump() if question.question else None


def normalize_buyer_questions(value: object, *, exclude: str = "") -> list[dict]:
    if isinstance(value, (str, dict)):
        value = [value]
    if not isinstance(value, list):
        return []
    excluded = exclude.strip().casefold()
    questions: list[dict] = []
    seen: set[str] = {excluded} if excluded else set()
    for raw in value:
        try:
            question = BuyerQuestion.model_validate(raw)
        except Exception:
            continue
        key = question.question.casefold()
        if not question.question or key in seen:
            continue
        seen.add(key)
        questions.append(question.model_dump())
    return questions[:MAX_BUYER_QUESTIONS]


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
    model: str = ""
    variant: str = ""
    identified_from: str = ""
    identification_confidence: float = Field(default=0.0, ge=0, le=1)
    standard_specs: list[str] = Field(default_factory=list)
    price_question: PriceQuestion | None = None
    buyer_questions: list[BuyerQuestion] = Field(default_factory=list)
    seller_facts: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _normalize_fields(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value

        data = dict(value)

        for key in ["brand", "item_name", "category", "condition", "model", "variant", "identified_from"]:
            val = str(data.get(key) or "").strip()
            if val.lower() in {"unknown", "n/a", "none"}:
                val = ""
            data[key] = val

        for key in ["confidence", "identification_confidence"]:
            try:
                data[key] = max(0.0, min(1.0, float(data.get(key) or 0.0)))
            except (TypeError, ValueError):
                data[key] = 0.0

        for key in ["detected_attributes", "visible_defects", "standard_specs", "seller_facts"]:
            raw = data.get(key)
            if isinstance(raw, list):
                data[key] = [str(i).strip() for i in raw if str(i).strip()]
            elif isinstance(raw, str):
                data[key] = [raw.strip()] if raw.strip() else []
            else:
                data[key] = []

        # Standard specs are only trustworthy when the exact model is identified.
        if data["identification_confidence"] < STANDARD_SPECS_MIN_CONFIDENCE:
            data["standard_specs"] = []
        data["standard_specs"] = data["standard_specs"][:MAX_STANDARD_SPECS]

        data["price_question"] = normalize_price_question(data.get("price_question"))
        price_question_text = (data["price_question"] or {}).get("question", "")
        data["buyer_questions"] = normalize_buyer_questions(
            data.get("buyer_questions"),
            exclude=price_question_text,
        )

        return data


class GeneratedListing(BaseModel):
    title: str = ""
    description: str = ""
    marketplace_category: str = ""
    tags: list[str] = Field(default_factory=list)
    price_suggestion: PriceSuggestion = Field(default_factory=lambda: PriceSuggestion(min=0, max=0))
    listing_quality: ListingQuality = Field(default_factory=ListingQuality)
    price_question: PriceQuestion | None = None
    buyer_questions: list[BuyerQuestion] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _normalize_questions(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        data = dict(value)
        data["price_question"] = normalize_price_question(data.get("price_question"))
        price_question_text = (data["price_question"] or {}).get("question", "")
        data["buyer_questions"] = normalize_buyer_questions(
            data.get("buyer_questions"),
            exclude=price_question_text,
        )
        return data


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


ActivePriceSource = Literal["ai_fast_sale", "ai_recommended", "ai_high_ask", "manual"]


class ListingAnswer(BaseModel):
    question: str = Field(min_length=1, max_length=300)
    answer: str = Field(min_length=1, max_length=300)
    affects_price: bool = False


class ListingChanges(BaseModel):
    """Seller edits from the edit form that can change the price or the description."""

    condition: str | None = Field(default=None, max_length=60)
    flaws: str | None = Field(default=None, max_length=600)
    brand_model: str | None = Field(default=None, max_length=200)
    accessories: str | None = Field(default=None, max_length=600)

    def has_changes(self) -> bool:
        return any(value is not None for value in (self.condition, self.flaws, self.brand_model, self.accessories))


class ListingAnswersRequest(BaseModel):
    answers: list[ListingAnswer] = Field(default_factory=list, max_length=8)
    changes: ListingChanges | None = None
    listing: GeneratedListing | None = None
    active_price: float = Field(default=0, ge=0)
    active_price_source: ActivePriceSource | None = None
    dismiss: bool = False


class ListingAnswersResponse(BaseModel):
    item_id: str
    listing: GeneratedListing
    analysis: VisionAnalysis | None = None
    missing_checklist: list[ChecklistItem] = Field(default_factory=list)
    repriced: bool = False
    active_price: float = 0
    active_price_source: ActivePriceSource | None = None


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
    warnings: list[str] = Field(default_factory=list)
    """Non-fatal problems from the last sync, e.g. a video too large for the Notion plan."""


class ItemVideo(BaseModel):
    """The listing's one video. On Marketplace it goes in the separate "Add video" slot."""

    id: str
    url: str
    content_type: str = "video/mp4"
    size_bytes: int = 0
    duration_seconds: float = 0
    frame_count: int = 0
    cover_from_video: bool = False


class ItemVideoResponse(BaseModel):
    item_id: str
    video: ItemVideo | None = None
    image_url: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    status: Literal["uploading", "uploaded"] = "uploaded"


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
    video: ItemVideo | None = None
    created_at: datetime
    updated_at: datetime


class ImageQualityError(BaseModel):
    detail: str
    issues: list[str]
    image_quality_feedback: list[ImageQualityFeedback] = Field(default_factory=list)
