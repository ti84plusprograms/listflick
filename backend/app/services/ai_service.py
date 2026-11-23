"""AI service — Gemini-backed vision analysis and listing generation."""

from __future__ import annotations

import base64
import logging
import time
from typing import Any

from app.prompts.listing import LISTING_SYSTEM_PROMPT, LISTING_USER_TEMPLATE
from app.prompts.vision import VISION_SYSTEM_PROMPT, VISION_USER_PROMPT
from app.schemas.gemini_outputs import GeminiListingOutput
from app.schemas.listing import GeneratedListing, ImprovementAction, PriceSuggestion, VisionAnalysis
from app.config import settings
from app.services.description_renderer import normalize_legacy_description, render_structured_description
from app.utils.condition import normalize_condition
from app.utils.json_parser import normalize_unknown

logger = logging.getLogger("uvicorn.error")


IMPROVEMENT_ACTION_LABELS: dict[ImprovementAction, str] = {
    "make_title_more_searchable": "Make the title more literal and searchable.",
    "make_description_shorter": "Make the description shorter while keeping key buyer details.",
    "make_description_more_casual": "Make the description more casual and friendly.",
    "make_description_more_professional": "Make the description more polished and professional.",
    "add_condition_details": "Add condition details using only provided condition and visible defects.",
    "improve_buyer_trust": "Improve buyer trust with clear, honest wording and placeholders for unknown logistics.",
    "make_price_more_competitive": "Make the pricing more competitive using the existing item context.",
    "generate_platform_ready_version": "Generate a polished platform-ready version for Facebook Marketplace.",
}


def _data_url_to_bytes(data_url: str) -> bytes:
    if "," in data_url:
        payload = data_url.split(",", 1)[1]
    else:
        payload = data_url
    return base64.b64decode(payload)


def _is_missing(value: str) -> bool:
    return not value or value.strip().lower() in {"unknown", "n/a", "none", "unclear"}


def _price_suggestion_from_output(
    price: dict,
    *,
    price_min: float,
    price_max: float,
    analysis: VisionAnalysis,
) -> PriceSuggestion:
    data = dict(price or {})
    if not any(
        data.get(key)
        for key in ("min", "max", "fast_sale_price", "recommended_price", "high_ask_price")
    ):
        data.update({"min": price_min, "max": price_max})

    suggestion = PriceSuggestion(**data)
    warnings = list(suggestion.pricing_warnings)
    confidence_cap = 1.0

    if suggestion.recommended_price <= 0:
        warnings.append("No usable price signal was available.")
        confidence_cap = min(confidence_cap, 0.25)
    if _is_missing(analysis.item_name):
        warnings.append("Item name is unclear.")
        confidence_cap = min(confidence_cap, 0.45)
    if _is_missing(analysis.category):
        warnings.append("Category is unclear.")
        confidence_cap = min(confidence_cap, 0.55)
    if _is_missing(analysis.condition):
        warnings.append("Condition is unclear.")
        confidence_cap = min(confidence_cap, 0.55)
    if _is_missing(analysis.brand):
        confidence_cap = min(confidence_cap, 0.8)
    if analysis.confidence < 0.55:
        warnings.append("Vision confidence is low.")
        confidence_cap = min(confidence_cap, 0.5)

    suggestion.confidence = round(min(suggestion.confidence or 0.6, confidence_cap), 2)
    if not suggestion.pricing_reason:
        suggestion.pricing_reason = "Based on category, condition, visible details, and available price hints."
    suggestion.pricing_warnings = list(dict.fromkeys(warnings))
    return suggestion


class AIService:
    """Preserves the existing AIService interface used by API routes."""

    def __init__(self, client: Any = None, *, provider: str | None = None, api_key: str | None = None) -> None:
        self._provider = provider or settings.ai_provider
        if client is not None:
            self._client = client
        elif (provider or settings.ai_provider) == "groq":
            from app.services.groq_client import groq_client

            self._client = groq_client if api_key is None else type(groq_client)(api_key=api_key)
        else:
            from app.services.gemini_client import gemini_client

            self._client = gemini_client if api_key is None else type(gemini_client)(api_key=api_key)

    @property
    def provider(self) -> str:
        return self._provider

    async def analyze_image(self, image_base64_url: str) -> VisionAnalysis:
        image_bytes = _data_url_to_bytes(image_base64_url)
        start = time.perf_counter()
        vision_out = await self._client.generate_json(
            system_instruction=VISION_SYSTEM_PROMPT,
            user_prompt=VISION_USER_PROMPT,
            image_bytes=image_bytes,
            schema_model=VisionAnalysis,
            max_output_tokens=2048,
        )
        logger.info("%s vision analysis completed in %.2fs", self._provider.upper(), time.perf_counter() - start)

        vision_out.condition = normalize_condition(vision_out.condition, defects=vision_out.visible_defects) or vision_out.condition
        return vision_out

    async def analyze_image_bytes(self, image_bytes: bytes) -> VisionAnalysis:
        """Analyze raw image bytes (preferred for Gemini multimodal input)."""
        import base64 as b64

        data_url = f"data:image/jpeg;base64,{b64.b64encode(image_bytes).decode()}"
        return await self.analyze_image(data_url)

    async def generate_listing(self, analysis: VisionAnalysis) -> GeneratedListing:
        price_min = analysis.suggested_price_min
        price_max = analysis.suggested_price_max

        user_prompt = LISTING_USER_TEMPLATE.format(
            item_name=analysis.item_name,
            brand=analysis.brand or "unknown",
            condition=analysis.condition,
            category=analysis.category,
            attributes=", ".join(analysis.detected_attributes) or "none",
            defects=", ".join(analysis.visible_defects) or "none visible",
            confidence=analysis.confidence,
            price_min=price_min,
            price_max=price_max,
        )

        start = time.perf_counter()
        gemini_out = await self._client.generate_json(
            system_instruction=LISTING_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            image_bytes=None,
            schema_model=GeminiListingOutput,
            max_output_tokens=2048,
        )
        logger.info("%s listing generation completed in %.2fs", self._provider.upper(), time.perf_counter() - start)

        description = normalize_legacy_description(gemini_out.description)
        if gemini_out.description_sections is not None:
            description = render_structured_description(
                gemini_out.description_sections,
                price=_price_suggestion_from_output(
                    gemini_out.price_suggestion or {},
                    price_min=price_min,
                    price_max=price_max,
                    analysis=analysis,
                ),
            )

        price_suggestion = _price_suggestion_from_output(
            gemini_out.price_suggestion or {},
            price_min=price_min,
            price_max=price_max,
            analysis=analysis,
        )
        return GeneratedListing(
            title=gemini_out.title,
            description=description,
            marketplace_category=gemini_out.marketplace_category or analysis.category,
            tags=gemini_out.tags,
            price_suggestion=price_suggestion,
        )

    async def improve_listing(
        self,
        listing: GeneratedListing,
        *,
        action: ImprovementAction,
        custom_instruction: str = "",
        analysis: VisionAnalysis | None = None,
    ) -> GeneratedListing:
        analysis_context = "No separate image analysis was provided."
        if analysis is not None:
            analysis_context = "\n".join(
                [
                    f"Item: {analysis.item_name or 'unknown'}",
                    f"Brand: {analysis.brand or 'unknown'}",
                    f"Condition: {analysis.condition or 'unknown'}",
                    f"Category: {analysis.category or 'unknown'}",
                    f"Attributes: {', '.join(analysis.detected_attributes) or 'none provided'}",
                    f"Visible defects: {', '.join(analysis.visible_defects) or 'none provided'}",
                    f"Vision confidence: {analysis.confidence}",
                ]
            )

        user_prompt = f"""Improve this existing marketplace listing.

Preset action: {action}
Action goal: {IMPROVEMENT_ACTION_LABELS[action]}
Custom seller instruction: {custom_instruction.strip() or "none"}

Known item context:
{analysis_context}

Current listing JSON:
{listing.model_dump_json()}

Rules:
- Return a complete listing JSON object matching the schema.
- Keep unchanged fields when the requested improvement does not require changing them.
- Do not invent brand, model, size, flaws, condition details, accessories, compatibility, pickup details, or payment methods.
- If a useful detail is missing, use a concise bracketed placeholder instead of guessing.
- Preserve the same marketplace category unless the current category is clearly empty and context supports one.
- For price changes, adjust price_suggestion only from the existing pricing/context and explain uncertainty in pricing_warnings.
- Keep the description plain text and ready to paste into Facebook Marketplace.
"""

        start = time.perf_counter()
        gemini_out = await self._client.generate_json(
            system_instruction=LISTING_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            image_bytes=None,
            schema_model=GeminiListingOutput,
            max_output_tokens=2048,
        )
        logger.info("Gemini listing improvement completed in %.2fs", time.perf_counter() - start)

        price_basis = gemini_out.price_suggestion or listing.price_suggestion.model_dump()
        price_min = listing.price_suggestion.min
        price_max = listing.price_suggestion.max
        price_analysis = analysis or VisionAnalysis(
            item_name=listing.title,
            category=listing.marketplace_category,
            condition="unknown",
            confidence=0.6,
        )

        price_suggestion = _price_suggestion_from_output(
            price_basis,
            price_min=price_min,
            price_max=price_max,
            analysis=price_analysis,
        )
        description = normalize_legacy_description(gemini_out.description or listing.description)
        if gemini_out.description_sections is not None:
            description = render_structured_description(
                gemini_out.description_sections,
                price=price_suggestion,
            )

        return GeneratedListing(
            title=gemini_out.title or listing.title,
            description=description,
            marketplace_category=gemini_out.marketplace_category or listing.marketplace_category,
            tags=gemini_out.tags or listing.tags,
            price_suggestion=price_suggestion,
        )


ai_service = AIService()
