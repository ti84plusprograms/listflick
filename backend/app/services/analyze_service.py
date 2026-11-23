import json
import logging
from datetime import datetime
from typing import Awaitable, Callable

from fastapi import HTTPException

from app.config import settings
from app.models.database import item_image_paths
from app.schemas.listing import (
    AnalysisJobStatus,
    AnalyzeResponse,
    GeneratedListing,
    ImproveListingRequest,
    ImproveListingResponse,
    ItemResponse,
    NotionSyncStatus,
    SaveListingRequest,
    SaveListingResponse,
    VisionAnalysis,
)
from app.services.ai_service import ai_service
from app.services.ai_credentials import (
    AICredentialRequiredError,
    AIProviderCredentialInvalidError,
    ResolvedAICredential,
    resolve_ai_credential,
    selected_provider,
)
from app.services.gemini_client import GeminiClientError, GeminiNotConfiguredError
from app.services.groq_client import GroqClientError, GroqNotConfiguredError
from app.services.image_service import validate_and_process
from app.services.listing_checklist import build_missing_checklist
from app.services.listing_response import (
    image_feedback_for_paths,
    notion_sync_from_item,
    quality_listing,
    save_listing_response,
)
from app.services.notion_service import NotionAPIError, notion_service
from app.services.notion_status import notion_capability
from app.services.storage import ImageAsset, Storage, StorageError, storage_service
from app.utils.condition import normalize_condition

logger = logging.getLogger("uvicorn.error")


def provider_credential_invalid_error(ai) -> HTTPException:
    detail = {
        "code": "AI_PROVIDER_CREDENTIAL_INVALID",
        "message": "The provider rejected this API key. Check the key in Settings and try again.",
    }
    provider = getattr(ai, "provider", None)
    if provider in {"gemini", "groq"}:
        detail["provider"] = provider
    return HTTPException(status_code=502, detail=detail)


def active_ai_provider(request_provider: str | None = None) -> str:
    try:
        return selected_provider(request_provider)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def ai_service_for_request(request_key: str | None = None, request_provider: str | None = None):
    provider = active_ai_provider(request_provider)
    if settings.e2e_mode:
        from app.services.e2e_ai_service import DeterministicE2EAIService

        return (
            DeterministicE2EAIService(provider=provider),
            ResolvedAICredential(provider=provider, value="", source="e2e_fixture"),
        )
    try:
        credential = resolve_ai_credential(provider, request_key)
    except AICredentialRequiredError as exc:
        logger.warning(
            "AI request rejected: missing credential for provider=%s (server_fallback_allowed=%s)",
            provider,
            settings.allow_server_ai_key_fallback,
        )
        raise HTTPException(
            status_code=503,
            detail={
                "code": "AI_CREDENTIAL_REQUIRED",
                "message": f"Add a {provider.title()} API key in Settings to use {provider.title()}.",
                "provider": provider,
            },
        ) from exc
    from app.services.ai_service import AIService

    return AIService(provider=credential.provider, api_key=credential.value), credential


def ensure_ai_provider_configured(request_key: str | None = None, request_provider: str | None = None):
    return ai_service_for_request(request_key, request_provider)


def provider_not_configured_error() -> HTTPException:
    return HTTPException(status_code=503, detail=f"{active_ai_provider().upper()} API key not configured")


def listing_models_from_item(
    item: dict,
    payload: SaveListingRequest | None = None,
) -> tuple[VisionAnalysis, GeneratedListing]:
    analysis_data = json.loads(item.get("analysis_json") or "{}")
    listing_data = json.loads(item.get("listing_json") or "{}")

    if payload is None:
        if not listing_data:
            raise HTTPException(status_code=400, detail="No saved listing is available to sync")
        return VisionAnalysis.model_validate(analysis_data), GeneratedListing.model_validate(listing_data)

    analysis_data.update({
        "condition": normalize_condition(payload.condition) or payload.condition or analysis_data.get("condition", ""),
        "category": payload.category or analysis_data.get("category", ""),
    })
    listing_data.update({
        "title": payload.title,
        "description": payload.description,
        "marketplace_category": payload.category,
        "price_suggestion": {
            "min": payload.asking_price,
            "max": payload.asking_price,
            "fast_sale_price": payload.asking_price,
            "recommended_price": payload.asking_price,
            "high_ask_price": payload.asking_price,
            "confidence": 1.0 if payload.asking_price > 0 else 0.0,
            "pricing_reason": "Final asking price set by seller.",
        },
    })

    return VisionAnalysis.model_validate(analysis_data), GeneratedListing.model_validate(listing_data)


def confirmed_keys_for_item(item: dict) -> set[str]:
    return {"category", "condition"} if item.get("status") == "saved" else set()


async def image_assets_for_paths(
    paths: list[str],
    *,
    storage: Storage = storage_service,
) -> list[ImageAsset]:
    assets: list[ImageAsset] = []
    for path in paths:
        try:
            assets.append(await storage.read(path))
        except StorageError:
            logger.warning("Could not read image %s", path, exc_info=True)
    return assets


async def analyze_item_record(
    item: dict,
    *,
    ai=ai_service,
    update_analysis: Callable[..., Awaitable[object]],
    storage: Storage = storage_service,
) -> AnalyzeResponse:
    item_id = item["id"]
    image_paths = item_image_paths(item)
    assets = await image_assets_for_paths(image_paths, storage=storage)
    if not assets:
        raise HTTPException(status_code=404, detail="Image file not found")

    image_bytes = assets[0].content
    try:
        analysis = await ai.analyze_image_bytes(image_bytes)
        listing = await ai.generate_listing(analysis)
    except Exception as exc:
        if isinstance(exc, (GeminiNotConfiguredError, GroqNotConfiguredError)):
            ensure_ai_provider_configured()
            raise provider_not_configured_error() from exc
        if isinstance(exc, AIProviderCredentialInvalidError):
            raise provider_credential_invalid_error(ai) from exc
        if isinstance(exc, (GeminiClientError, GroqClientError)):
            logger.warning("Listing generation failed for %s: %s", item_id, exc)
            raise HTTPException(status_code=502, detail="Could not generate listing right now") from exc
        raise

    _, metrics, _ = validate_and_process(image_bytes)
    feedback = await image_feedback_for_paths(image_paths, item_id, storage=storage)
    checklist = build_missing_checklist(analysis, listing)
    listing = quality_listing(
        analysis,
        listing,
        missing_checklist=checklist,
        image_quality_feedback=feedback,
    )
    await update_analysis(
        item_id,
        analysis.model_dump(),
        listing.model_dump(),
        user_id=item["user_id"],
    )
    return AnalyzeResponse(
        item_id=item_id,
        analysis=analysis,
        listing=listing,
        missing_checklist=checklist,
        image_quality=metrics,
        image_quality_feedback=feedback,
    )


async def improve_listing_record(
    payload: ImproveListingRequest,
    item: dict | None,
    *,
    ai=ai_service,
) -> ImproveListingResponse:
    analysis = payload.analysis
    listing = payload.listing
    if item:
        if analysis is None and item.get("analysis_json"):
            analysis = VisionAnalysis.model_validate_json(item["analysis_json"])
        if listing is None and item.get("listing_json"):
            listing = GeneratedListing.model_validate_json(item["listing_json"])

    if listing is None:
        raise HTTPException(status_code=400, detail="Listing is required")

    try:
        improved = await ai.improve_listing(
            listing,
            action=payload.action,
            custom_instruction=payload.custom_instruction,
            analysis=analysis,
        )
    except Exception as exc:
        if isinstance(exc, (GeminiNotConfiguredError, GroqNotConfiguredError)):
            ensure_ai_provider_configured()
            raise provider_not_configured_error() from exc
        if isinstance(exc, AIProviderCredentialInvalidError):
            raise provider_credential_invalid_error(ai) from exc
        if isinstance(exc, (GeminiClientError, GroqClientError)):
            logger.warning("Listing improvement failed: %s", exc)
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        raise

    checklist = build_missing_checklist(analysis, improved) if analysis else []
    improved = quality_listing(analysis, improved, missing_checklist=checklist)
    return ImproveListingResponse(
        item_id=payload.item_id,
        listing=improved,
        missing_checklist=checklist,
    )


async def sync_item_to_notion(
    item: dict,
    analysis: VisionAnalysis,
    listing: GeneratedListing,
    *,
    notion=notion_service,
    get_item_record: Callable[[str], Awaitable[dict | None]],
    update_notion_sync: Callable[..., Awaitable[object]],
    claim_notion_sync: Callable[..., Awaitable[tuple[dict, str | None]]],
    finish_notion_sync: Callable[..., Awaitable[dict]],
    storage: Storage = storage_service,
    notion_sync_enabled: bool | None = None,
) -> NotionSyncStatus:
    client_disabled = notion_sync_enabled is False and settings.notion_allow_client_override
    if client_disabled or not notion.is_configured:
        reason = "client_disabled" if client_disabled else notion_capability()["reason"]
        await update_notion_sync(
            item["id"],
            item["user_id"],
            sync_status="not_synced",
            reason=reason,
            last_error=None,
        )
        refreshed = await get_item_record(item["id"])
        logger.info("Notion sync skipped item_id=%s reason=%s", item["id"], reason)
        return notion_sync_from_item(refreshed or item)

    claimed_item, lease_token = await claim_notion_sync(
        item["id"],
        item["user_id"],
        lease_seconds=settings.notion_sync_lease_seconds,
    )
    if lease_token is None:
        logger.info("Notion sync already in progress item_id=%s", item["id"])
        return notion_sync_from_item(claimed_item)

    async def finish_or_refresh(**result: object) -> dict:
        try:
            return await finish_notion_sync(
                item["id"],
                item["user_id"],
                lease_token,
                **result,
            )
        except RuntimeError:
            logger.warning("Notion sync lease superseded item_id=%s", item["id"])
            refreshed = await get_item_record(item["id"])
            if refreshed is None:
                raise LookupError("Item not found for this user")
            return refreshed

    try:
        result = await notion.create_listing_entry(
            item_id=item["id"],
            analysis=analysis,
            listing=listing,
            image_assets=await image_assets_for_paths(
                item_image_paths(claimed_item),
                storage=storage,
            ),
            existing_page_id=claimed_item.get("notion_page_id"),
            reconcile_ambiguous=bool(claimed_item.get("notion_create_ambiguous")),
        )
        if result is None:
            finished = await finish_or_refresh(
                sync_status="not_synced",
                last_error=None,
            )
        else:
            finished = await finish_or_refresh(
                sync_status="synced",
                page_id=result.page_id,
                page_url=result.page_url,
                succeeded=True,
                last_error=None,
            )
    except NotionAPIError as exc:
        logger.warning("Notion sync result item_id=%s code=%s", item["id"], exc.code)
        create_ambiguous = bool(claimed_item.get("notion_create_ambiguous")) or (
            not claimed_item.get("notion_page_id")
            and exc.code in {"timeout", "network", "tls"}
        )
        finished = await finish_or_refresh(
            sync_status="failed",
            last_error=str(exc),
            create_ambiguous=create_ambiguous,
        )

    return notion_sync_from_item(finished)


async def save_item_record(
    item: dict,
    payload: SaveListingRequest,
    *,
    notion=notion_service,
    get_item_record: Callable[[str], Awaitable[dict | None]],
    update_analysis: Callable[..., Awaitable[object]],
    update_notion_sync: Callable[..., Awaitable[object]],
    claim_notion_sync: Callable[..., Awaitable[tuple[dict, str | None]]],
    finish_notion_sync: Callable[..., Awaitable[dict]],
    storage: Storage = storage_service,
) -> SaveListingResponse:
    item_id = item["id"]
    analysis, listing = listing_models_from_item(item, payload)
    feedback = await image_feedback_for_paths(item_image_paths(item), item_id, storage=storage)
    checklist = build_missing_checklist(
        analysis,
        listing,
        confirmed_keys={"category", "condition"},
    )
    listing = quality_listing(
        analysis,
        listing,
        missing_checklist=checklist,
        image_quality_feedback=feedback,
    )

    try:
        await update_analysis(
            item_id,
            analysis.model_dump(),
            listing.model_dump(),
            status="saved",
            user_id=item["user_id"],
        )
    except Exception as exc:
        logger.error("Failed to save listing for item %s: %s", item_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Could not save listing") from exc

    refreshed = await get_item_record(item_id)
    notion_sync = await sync_item_to_notion(
        refreshed or item,
        analysis,
        listing,
        notion=notion,
        get_item_record=get_item_record,
        update_notion_sync=update_notion_sync,
        claim_notion_sync=claim_notion_sync,
        finish_notion_sync=finish_notion_sync,
        storage=storage,
        notion_sync_enabled=payload.notion_sync_enabled,
    )
    return save_listing_response(item_id, listing, checklist, feedback, notion_sync)


async def retry_notion_sync_record(
    item: dict,
    *,
    notion=notion_service,
    get_item_record: Callable[[str], Awaitable[dict | None]],
    update_notion_sync: Callable[..., Awaitable[object]],
    claim_notion_sync: Callable[..., Awaitable[tuple[dict, str | None]]],
    finish_notion_sync: Callable[..., Awaitable[dict]],
    storage: Storage = storage_service,
    notion_sync_enabled: bool | None = None,
) -> SaveListingResponse:
    item_id = item["id"]
    analysis, listing = listing_models_from_item(item)
    feedback = await image_feedback_for_paths(item_image_paths(item), item_id, storage=storage)
    checklist = build_missing_checklist(
        analysis,
        listing,
        confirmed_keys=confirmed_keys_for_item(item),
    )
    listing = quality_listing(
        analysis,
        listing,
        missing_checklist=checklist,
        image_quality_feedback=feedback,
    )
    notion_sync = await sync_item_to_notion(
        item,
        analysis,
        listing,
        notion=notion,
        get_item_record=get_item_record,
        update_notion_sync=update_notion_sync,
        claim_notion_sync=claim_notion_sync,
        finish_notion_sync=finish_notion_sync,
        storage=storage,
        notion_sync_enabled=notion_sync_enabled,
    )
    return save_listing_response(item_id, listing, checklist, feedback, notion_sync)


async def item_response_from_record(
    item: dict,
    *,
    storage: Storage = storage_service,
    analysis_job: AnalysisJobStatus | None = None,
) -> ItemResponse:
    item_id = item["id"]
    analysis = (
        VisionAnalysis.model_validate_json(item["analysis_json"])
        if item.get("analysis_json")
        else None
    )
    listing = (
        GeneratedListing.model_validate_json(item["listing_json"])
        if item.get("listing_json")
        else None
    )
    feedback = await image_feedback_for_paths(item_image_paths(item), item_id, storage=storage)
    checklist = (
        build_missing_checklist(
            analysis,
            listing,
            confirmed_keys=confirmed_keys_for_item(item),
        )
        if analysis and listing
        else []
    )
    if listing:
        listing = quality_listing(
            analysis,
            listing,
            missing_checklist=checklist,
            image_quality_feedback=feedback,
        )

    return ItemResponse(
        id=item_id,
        image_url=f"/api/items/{item_id}/image",
        status=item["status"],
        analysis=analysis,
        listing=listing,
        missing_checklist=checklist,
        image_quality_feedback=feedback,
        analysis_job=analysis_job,
        notion_sync=notion_sync_from_item(item),
        created_at=datetime.fromisoformat(item["created_at"]),
        updated_at=datetime.fromisoformat(item["updated_at"]),
    )
