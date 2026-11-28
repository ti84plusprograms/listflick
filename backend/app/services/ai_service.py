"""AI service: vision analysis and listing generation through Gemini, Groq or Claude."""

from __future__ import annotations

import base64
import logging
import time
from typing import Any

from app.prompts.listing import LISTING_SYSTEM_PROMPT, LISTING_USER_TEMPLATE, REVISION_USER_TEMPLATE
from app.prompts.vision import VISION_SYSTEM_PROMPT, VISION_USER_PROMPT, vision_user_prompt
from app.schemas.gemini_outputs import GeminiListingOutput
from app.schemas.listing import (
    BuyerQuestion,
    GeneratedListing,
    ImprovementAction,
    PriceQuestion,
    PriceSuggestion,
    VisionAnalysis,
)
from app.config import settings
from app.services.description_renderer import (
    normalize_description,
    render_structured_description,
    strip_price_lines,
)
from app.services.image_payload import MAX_ANALYSIS_IMAGES
from app.utils.condition import normalize_condition
from app.utils.humanize import humanize_text, humanize_title
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


def _humanize_output(output: GeminiListingOutput) -> GeminiListingOutput:
    """Strip formatting tells (dashes, emojis, curly quotes, bold) from model text before rendering."""
    output.title = humanize_title(output.title)
    output.description = humanize_text(output.description)
    sections = output.description_sections
    if sections is not None:
        sections.opening = humanize_text(sections.opening)
        sections.features = [line for line in (humanize_text(f) for f in sections.features) if line]
        sections.condition_details = humanize_text(sections.condition_details)
        sections.pickup_details = [line for line in (humanize_text(p) for p in sections.pickup_details) if line]
        sections.closing = humanize_text(sections.closing)
    price = output.price_suggestion
    if isinstance(price, dict) and isinstance(price.get("pricing_reason"), str):
        price["pricing_reason"] = humanize_text(price["pricing_reason"])
    return output


def _humanize_questions(analysis: VisionAnalysis) -> VisionAnalysis:
    """Questions are shown to the seller, so they get the same formatting cleanup as listing text."""
    if analysis.price_question is not None:
        question = analysis.price_question
        analysis.price_question = PriceQuestion(
            question=humanize_text(question.question),
            why=humanize_text(question.why),
            options=[humanize_text(option) for option in question.options],
        )
    analysis.buyer_questions = [
        BuyerQuestion(
            question=humanize_text(question.question),
            options=[humanize_text(option) for option in question.options],
            affects_price=question.affects_price,
        )
        for question in analysis.buyer_questions
    ]
    return analysis


def _price_question_text(analysis: VisionAnalysis) -> str:
    question = analysis.price_question
    if question is None or not question.question:
        return "none"
    options = f" Options: {', '.join(question.options)}." if question.options else ""
    return f"{question.question}{options}"


def analysis_context_lines(analysis: VisionAnalysis) -> list[str]:
    """Plain-text item context shared by the improve and revise prompts."""
    return [
        f"Item: {analysis.item_name or 'unknown'}",
        f"Brand: {analysis.brand or 'unknown'}",
        f"Model: {analysis.model or 'unknown'}",
        f"Variant: {analysis.variant or 'unknown'}",
        f"Identified from: {analysis.identified_from or 'not stated'}",
        f"Standard specs for this model: {'; '.join(analysis.standard_specs) or 'none'}",
        f"Condition: {analysis.condition or 'unknown'}",
        f"Category: {analysis.category or 'unknown'}",
        f"Attributes: {', '.join(analysis.detected_attributes) or 'none provided'}",
        f"Visible defects: {', '.join(analysis.visible_defects) or 'none provided'}",
        f"Seller facts (highest priority): {'; '.join(analysis.seller_facts) or 'none'}",
        f"Vision confidence: {analysis.confidence}",
    ]


class AIService:
    """Preserves the existing AIService interface used by API routes."""

    def __init__(self, client: Any = None, *, provider: str | None = None, api_key: str | None = None) -> None:
        self._provider = provider or settings.ai_provider
        if client is not None:
            self._client = client
        elif (provider or settings.ai_provider) == "groq":
            from app.services.groq_client import groq_client

            self._client = groq_client if api_key is None else type(groq_client)(api_key=api_key)
        elif (provider or settings.ai_provider) == "claude":
            from app.services.claude_client import claude_client

            self._client = claude_client if api_key is None else type(claude_client)(api_key=api_key)
        else:
            from app.services.gemini_client import gemini_client

            self._client = gemini_client if api_key is None else type(gemini_client)(api_key=api_key)

    @property
    def provider(self) -> str:
        return self._provider

    async def analyze_image(
        self,
        image_base64_url: str,
        *,
        images: list[bytes] | None = None,
        user_prompt: str | None = None,
    ) -> VisionAnalysis:
        image_bytes = _data_url_to_bytes(image_base64_url)
        request: dict[str, Any] = {
            "system_instruction": VISION_SYSTEM_PROMPT,
            "user_prompt": user_prompt or VISION_USER_PROMPT,
            "image_bytes": image_bytes,
            "schema_model": VisionAnalysis,
            "max_output_tokens": 3072,
        }
        if images and len(images) > 1:
            # All photos of the one item go in a single call; image 1 stays the cover.
            request["images"] = list(images)[:MAX_ANALYSIS_IMAGES]
        start = time.perf_counter()
        vision_out = await self._client.generate_json(**request)
        logger.info(
            "%s vision analysis of %d photo(s) completed in %.2fs",
            self._provider.upper(),
            len(request.get("images") or [image_bytes]),
            time.perf_counter() - start,
        )

        vision_out.condition = normalize_condition(vision_out.condition, defects=vision_out.visible_defects) or vision_out.condition
        return _humanize_questions(vision_out)

    async def analyze_image_bytes(self, image_bytes: bytes) -> VisionAnalysis:
        """Analyze raw image bytes (preferred for Gemini multimodal input)."""
        import base64 as b64

        data_url = f"data:image/jpeg;base64,{b64.b64encode(image_bytes).decode()}"
        return await self.analyze_image(data_url)

    async def analyze_images(
        self,
        images: list[bytes],
        *,
        video_frames: list[bytes] | None = None,
        frame_times: list[float] | None = None,
        video_duration: float = 0,
        cover_from_video: bool = False,
    ) -> VisionAnalysis:
        """Analyze every photo of one item (cover first) in a single vision call.

        ``video_frames`` are stills from the seller's video. They go after the photos in the
        same call, and the prompt tells the model which images are frames and when they were taken.
        """
        import base64 as b64

        photos = [image for image in images if image][:MAX_ANALYSIS_IMAGES]
        if not photos:
            raise ValueError("At least one image is required")
        frames = [frame for frame in (video_frames or []) if frame][: max(0, MAX_ANALYSIS_IMAGES - len(photos))]
        times = list(frame_times or [])[: len(frames)]
        if len(times) < len(frames):
            frames = frames[: len(times)]
        prompt = (
            vision_user_prompt(len(photos), times, video_duration, cover_from_video=cover_from_video)
            if frames
            else None
        )
        data_url = f"data:image/jpeg;base64,{b64.b64encode(photos[0]).decode()}"
        return await self.analyze_image(data_url, images=[*photos, *frames], user_prompt=prompt)

    async def generate_listing(self, analysis: VisionAnalysis) -> GeneratedListing:
        price_min = analysis.suggested_price_min
        price_max = analysis.suggested_price_max

        user_prompt = LISTING_USER_TEMPLATE.format(
            item_name=analysis.item_name,
            brand=analysis.brand or "unknown",
            model=analysis.model or "unknown",
            variant=analysis.variant or "unknown",
            identified_from=analysis.identified_from or "not stated",
            identification_confidence=analysis.identification_confidence,
            standard_specs="; ".join(analysis.standard_specs) or "none",
            condition=analysis.condition,
            category=analysis.category,
            attributes=", ".join(analysis.detected_attributes) or "none",
            defects=", ".join(analysis.visible_defects) or "none visible",
            seller_facts="; ".join(analysis.seller_facts) or "none",
            price_question=_price_question_text(analysis),
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
        gemini_out = _humanize_output(gemini_out)

        description = strip_price_lines(normalize_description(gemini_out.description))
        if gemini_out.description_sections is not None:
            description = render_structured_description(
                gemini_out.description_sections,
                price=_price_suggestion_from_output(
                    gemini_out.price_suggestion or {},
                    price_min=price_min,
                    price_max=price_max,
                    analysis=analysis,
                ),
                condition=analysis.condition,
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
            price_question=analysis.price_question,
            buyer_questions=analysis.buyer_questions,
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
            analysis_context = "\n".join(analysis_context_lines(analysis))

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
- If a useful detail is missing, leave it out instead of guessing.
- Preserve the same marketplace category unless the current category is clearly empty and context supports one.
- For price changes, adjust price_suggestion only from the existing pricing/context and explain uncertainty in pricing_warnings.
- Keep the description plain text and ready to paste into Facebook Marketplace. No price in the description.
"""

        start = time.perf_counter()
        gemini_out = await self._client.generate_json(
            system_instruction=LISTING_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            image_bytes=None,
            schema_model=GeminiListingOutput,
            max_output_tokens=2048,
        )
        logger.info("%s listing improvement completed in %.2fs", self._provider.upper(), time.perf_counter() - start)
        gemini_out = _humanize_output(gemini_out)

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
        description = normalize_description(gemini_out.description or listing.description)
        if gemini_out.description.strip():
            # Model-written text loses its emoji headers to the humanizer, so a stale price line
            # would no longer be recognized as one by the app. Marketplace shows price separately.
            description = strip_price_lines(description) or description
        if gemini_out.description_sections is not None:
            description = render_structured_description(
                gemini_out.description_sections,
                price=price_suggestion,
                condition=analysis.condition if analysis is not None else "",
            )

        return GeneratedListing(
            title=gemini_out.title or listing.title,
            description=description,
            marketplace_category=gemini_out.marketplace_category or listing.marketplace_category,
            tags=gemini_out.tags or listing.tags,
            price_suggestion=price_suggestion,
            price_question=listing.price_question,
            buyer_questions=listing.buyer_questions,
        )

    async def revise_listing(
        self,
        listing: GeneratedListing,
        *,
        analysis: VisionAnalysis | None,
        new_facts: list[str],
        reprice: bool,
    ) -> GeneratedListing:
        """Fold seller answers or edits into the listing, re-pricing only when they affect price.

        The description is revised in place (the seller's wording is kept) and returned without a
        price line. When ``reprice`` is false the existing price suggestion is kept unchanged.
        """
        analysis_context = "No separate image analysis was provided."
        if analysis is not None:
            analysis_context = "\n".join(analysis_context_lines(analysis))
        reprice_instruction = (
            "Yes. Price this exact version again with the same reseller method, using the new facts."
            if reprice
            else "No. Return the current price_suggestion unchanged."
        )
        user_prompt = REVISION_USER_TEMPLATE.format(
            analysis_context=analysis_context,
            new_facts="\n".join(f"- {fact}" for fact in new_facts) or "- none",
            listing_json=listing.model_dump_json(
                include={"title", "description", "marketplace_category", "tags", "price_suggestion"}
            ),
            reprice_instruction=reprice_instruction,
        )

        start = time.perf_counter()
        gemini_out = await self._client.generate_json(
            system_instruction=LISTING_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            image_bytes=None,
            schema_model=GeminiListingOutput,
            max_output_tokens=2048,
        )
        logger.info("%s listing revision completed in %.2fs", self._provider.upper(), time.perf_counter() - start)
        gemini_out = _humanize_output(gemini_out)

        if reprice:
            price_analysis = analysis or VisionAnalysis(
                item_name=listing.title,
                category=listing.marketplace_category,
                condition="unknown",
                confidence=0.6,
            )
            price_suggestion = _price_suggestion_from_output(
                gemini_out.price_suggestion or listing.price_suggestion.model_dump(),
                price_min=listing.price_suggestion.min,
                price_max=listing.price_suggestion.max,
                analysis=price_analysis,
            )
        else:
            price_suggestion = listing.price_suggestion

        description = listing.description
        if gemini_out.description.strip():
            description = normalize_description(gemini_out.description)
        elif gemini_out.description_sections is not None:
            description = render_structured_description(
                gemini_out.description_sections,
                condition=analysis.condition if analysis is not None else "",
            )
        description = strip_price_lines(description) or listing.description

        return GeneratedListing(
            title=gemini_out.title or listing.title,
            description=description,
            marketplace_category=gemini_out.marketplace_category or listing.marketplace_category,
            tags=gemini_out.tags or listing.tags,
            price_suggestion=price_suggestion,
            price_question=listing.price_question,
            buyer_questions=listing.buyer_questions,
        )


ai_service = AIService()
