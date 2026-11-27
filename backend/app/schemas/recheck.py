"""Request and response shapes for re-checking AI listing tips."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.schemas.listing import ImageQualityFeedback

MAX_RECHECK_TIPS = 6


class ListingTip(BaseModel):
    text: str = Field(max_length=500)
    done: bool = False


class RecheckListingRequest(BaseModel):
    item_id: str | None = None
    # Bounded so a re-check can't be used to send an arbitrarily large prompt on the server's key.
    title: str = Field(default="", max_length=300)
    description: str = Field(default="", max_length=10000)
    category: str = Field(default="", max_length=120)
    condition: str = Field(default="", max_length=60)
    asking_price: float = Field(default=0, ge=0)
    tips: list[ListingTip] = Field(default_factory=list, max_length=12)
    include_images: bool = False


class RecheckListingResponse(BaseModel):
    item_id: str | None = None
    tips: list[ListingTip] = Field(default_factory=list)
    image_quality_feedback: list[ImageQualityFeedback] = Field(default_factory=list)
    checked_images: int = 0


class RecheckPhotoVerdict(BaseModel):
    image_index: int = 0
    overall_status: str = ""
    suggested_action: str = ""


class RecheckModelOutput(BaseModel):
    """Lenient shape for the model's reply; bad entries are dropped, not rejected."""

    done: list[int] = Field(default_factory=list)
    new_suggestions: list[str] = Field(default_factory=list)
    image_quality_feedback: list[RecheckPhotoVerdict] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _coerce(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        data = dict(value)

        done: list[int] = []
        for raw in data.get("done") or []:
            try:
                done.append(int(round(float(str(raw).strip()))))
            except (TypeError, ValueError):
                continue
        data["done"] = done

        suggestions = data.get("new_suggestions") or []
        if isinstance(suggestions, str):
            suggestions = [suggestions]
        data["new_suggestions"] = [str(s).strip() for s in suggestions if isinstance(s, (str, int, float)) and str(s).strip()]

        verdicts: list[dict[str, Any]] = []
        for raw in data.get("image_quality_feedback") or []:
            if not isinstance(raw, dict):
                continue
            try:
                index = int(round(float(raw.get("image_index"))))
            except (TypeError, ValueError):
                continue
            verdicts.append(
                {
                    "image_index": index,
                    "overall_status": str(raw.get("overall_status") or "").strip().lower(),
                    "suggested_action": str(raw.get("suggested_action") or "").strip(),
                }
            )
        data["image_quality_feedback"] = verdicts
        return data
