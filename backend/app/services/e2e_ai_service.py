"""Deterministic AI fixture available only through the guarded local E2E mode."""

from __future__ import annotations

import asyncio

from app.schemas.listing import GeneratedListing, ImprovementAction, ListingQuality, PriceSuggestion, VisionAnalysis

PROCESSING_VISIBILITY_SECONDS = 5.0


class DeterministicE2EAIService:
    """Return stable realistic listing data without constructing a provider client."""

    def __init__(self, *, provider: str) -> None:
        self._provider = provider

    @property
    def provider(self) -> str:
        return self._provider

    async def analyze_image_bytes(self, image_bytes: bytes) -> VisionAnalysis:
        if not image_bytes:
            raise ValueError("The E2E image fixture must not be empty")
        # Keep the real Processing screen observable to black-box UI tests.
        # Production providers never instantiate this E2E-only service.
        await asyncio.sleep(PROCESSING_VISIBILITY_SECONDS)
        return VisionAnalysis(
            item_name="Vintage Canon Camera",
            brand="Canon",
            condition="Used - Good",
            category="Cameras & Photography",
            confidence=0.98,
            detected_attributes=["35mm film camera", "black and silver body", "standard lens"],
            visible_defects=["Light cosmetic wear"],
            suggested_price_min=100,
            suggested_price_max=150,
        )

    async def generate_listing(self, analysis: VisionAnalysis) -> GeneratedListing:
        await asyncio.sleep(0.4)
        return GeneratedListing(
            title="Vintage Canon Camera",
            description="A deterministic test listing description.",
            marketplace_category=analysis.category,
            tags=["camera", "vintage", "film"],
            price_suggestion=PriceSuggestion(
                min=100,
                max=150,
                fast_sale_price=110,
                recommended_price=125,
                high_ask_price=140,
                confidence=0.95,
                pricing_reason="Deterministic E2E fixture pricing.",
            ),
            listing_quality=ListingQuality(
                overall_score=92,
                readiness_label="ready",
                score_breakdown={"title": 95, "description": 90, "pricing": 92},
                improvement_suggestions=[],
            ),
        )

    async def improve_listing(
        self,
        listing: GeneratedListing,
        *,
        action: ImprovementAction,
        custom_instruction: str = "",
        analysis: VisionAnalysis | None = None,
    ) -> GeneratedListing:
        del custom_instruction, analysis
        if action == "improve_buyer_trust":
            return listing.model_copy(
                deep=True,
                update={
                    "title": "Vintage Canon AE-1 35mm Film Camera",
                    "description": (
                        "Vintage Canon AE-1 35mm film camera in good used condition. "
                        "It has light cosmetic wear from normal use.\n\n"
                        "🔹 Features:\n"
                        "- Brand/model: Canon AE-1"
                    ),
                },
            )
        return listing.model_copy(deep=True)
