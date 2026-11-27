import json
import logging
from datetime import datetime
from typing import Awaitable, Callable

from fastapi import HTTPException

from app.config import settings
from app.models.database import item_image_paths, item_notion_media, item_video_record
from app.schemas.listing import (
    AnalysisJobStatus,
    AnalyzeResponse,
    GeneratedListing,
    ImproveListingRequest,
    ImproveListingResponse,
    ItemResponse,
    ListingAnswer,
    ListingAnswersRequest,
    ListingAnswersResponse,
    ListingChanges,
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
from app.services.claude_client import ClaudeClientError, ClaudeNotConfiguredError
from app.services.gemini_client import GeminiClientError, GeminiNotConfiguredError
from app.services.groq_client import GroqClientError, GroqNotConfiguredError
from app.services.groq_client import GROQ_MAX_IMAGE_BYTES, GROQ_MAX_IMAGES
from app.services.image_payload import MAX_ANALYSIS_IMAGES, collect_images
from app.services.image_service import ImageQualityError, build_image_quality_feedback, validate_and_process
from app.services.listing_checklist import build_missing_checklist
from app.services.listing_response import (
    image_feedback_for_paths,
    notion_sync_from_item,
    quality_listing,
    save_listing_response,
)
from app.services.notion_service import VIDEO_TOO_LARGE_WARNING, NotionAPIError, NotionVideo, notion_service
from app.services.notion_status import notion_capability
from app.services.storage import ImageAsset, Storage, StorageError, storage_service
from app.services.video_frames import frame_budget
from app.services.video_service import item_video_payload, video_cover_paths
from app.utils.condition import normalize_condition
from app.config import SUPPORTED_AI_PROVIDERS

logger = logging.getLogger("uvicorn.error")

PROVIDER_NOT_CONFIGURED_ERRORS = (GeminiNotConfiguredError, GroqNotConfiguredError, ClaudeNotConfiguredError)
PROVIDER_CLIENT_ERRORS = (GeminiClientError, GroqClientError, ClaudeClientError)


def provider_credential_invalid_error(ai) -> HTTPException:
    detail = {
        "code": "AI_PROVIDER_CREDENTIAL_INVALID",
        "message": "The provider rejected this API key. Check the key in Settings and try again.",
    }
    provider = getattr(ai, "provider", None)
    if provider in SUPPORTED_AI_PROVIDERS:
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


def analysis_image_limits(ai) -> tuple[int, int | None]:
    """How many images (and bytes) the provider takes in one vision call."""
    if getattr(ai, "provider", None) == "groq":
        return GROQ_MAX_IMAGES, GROQ_MAX_IMAGE_BYTES
    return MAX_ANALYSIS_IMAGES, None


def plan_analysis_media(
    photos: list[bytes],
    frames: list[tuple[bytes, float, int]],
    *,
    max_images: int = MAX_ANALYSIS_IMAGES,
    max_total_bytes: int | None = None,
) -> tuple[list[bytes], list[tuple[bytes, float]]]:
    """Choose the photos and video frames for one vision call, photos first.

    ``frames`` are ``(content, time, rank)``; rank is the order frame selection picked
    them, so the best ``budget`` frames are the lowest ranks. The budget is
    ``min(6, max(2, max_images - photo_count))``; photos give way only so the frames that
    fit the budget still go in.
    """
    if not frames:
        return photos[:max_images], []
    budget = frame_budget(len(photos), max_images)
    chosen = sorted(frames, key=lambda frame: frame[2])[:budget]
    photo_count = min(len(photos), max(1, max_images - len(chosen)))
    chosen = chosen[: max(0, max_images - photo_count)]
    chosen.sort(key=lambda frame: frame[1])
    used_photos = photos[:photo_count]
    if max_total_bytes is not None:
        kept = collect_images(
            images=[*used_photos, *(frame[0] for frame in chosen)],
            limit=max_images,
            max_total_bytes=max_total_bytes,
        )
        used_photos = used_photos[: min(len(used_photos), len(kept))]
        chosen = chosen[: max(0, len(kept) - len(used_photos))]
    return used_photos, [(frame[0], frame[1]) for frame in chosen]


async def video_frames_for_item(
    item: dict,
    *,
    storage: Storage = storage_service,
) -> list[tuple[bytes, float, int]]:
    video = item_video_record(item)
    frames: list[tuple[bytes, float, int]] = []
    for index, frame in enumerate((video or {}).get("frames") or []):
        if not isinstance(frame, dict) or not frame.get("path"):
            continue
        try:
            asset = await storage.read(str(frame["path"]))
        except StorageError:
            logger.warning("Could not read a video frame for item %s", item.get("id"), exc_info=True)
            continue
        frames.append((asset.content, float(frame.get("time") or 0), int(frame.get("rank", index))))
    return frames


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
    photos = [asset.content for asset in assets[:MAX_ANALYSIS_IMAGES]]
    analyze_images = getattr(ai, "analyze_images", None)
    video = item_video_record(item)
    frames: list[tuple[bytes, float]] = []
    if video and callable(analyze_images):
        max_images, max_bytes = analysis_image_limits(ai)
        photos, frames = plan_analysis_media(
            photos,
            await video_frames_for_item(item, storage=storage),
            max_images=max_images,
            max_total_bytes=max_bytes,
        )
    try:
        if frames:
            # Photos first, then the video frames, all in one vision call.
            analysis = await analyze_images(
                photos,
                video_frames=[frame[0] for frame in frames],
                frame_times=[frame[1] for frame in frames],
                video_duration=float(video.get("duration_seconds") or 0),
                cover_from_video=bool(video_cover_paths(item) & set(image_paths[:1])),
            )
        elif len(photos) > 1 and callable(analyze_images):
            # Every photo is a view of the same item; image 1 (the cover) leads.
            analysis = await analyze_images(photos)
        else:
            analysis = await ai.analyze_image_bytes(image_bytes)
        listing = await ai.generate_listing(analysis)
    except Exception as exc:
        if isinstance(exc, PROVIDER_NOT_CONFIGURED_ERRORS):
            ensure_ai_provider_configured()
            raise provider_not_configured_error() from exc
        if isinstance(exc, AIProviderCredentialInvalidError):
            raise provider_credential_invalid_error(ai) from exc
        if isinstance(exc, PROVIDER_CLIENT_ERRORS):
            logger.warning("Listing generation failed for %s: %s", item_id, exc)
            raise HTTPException(status_code=502, detail="Could not generate listing right now") from exc
        raise

    try:
        _, metrics, _ = validate_and_process(image_bytes)
    except ImageQualityError:
        # A cover taken from the video is not held to the photo upload checks.
        _, metrics = build_image_quality_feedback(image_bytes)
    feedback = await image_feedback_for_paths(
        image_paths, item_id, storage=storage, skip_paths=video_cover_paths(item)
    )
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
        if isinstance(exc, PROVIDER_NOT_CONFIGURED_ERRORS):
            ensure_ai_provider_configured()
            raise provider_not_configured_error() from exc
        if isinstance(exc, AIProviderCredentialInvalidError):
            raise provider_credential_invalid_error(ai) from exc
        if isinstance(exc, PROVIDER_CLIENT_ERRORS):
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


def _question_key(value: str) -> str:
    return " ".join(value.split()).casefold().rstrip("?.! ")


def answer_affects_price(answer: ListingAnswer, listing: GeneratedListing) -> bool:
    """An answer moves the price when the seller says so or the stored question was price-related."""
    if answer.affects_price:
        return True
    key = _question_key(answer.question)
    price_question = listing.price_question
    if price_question is not None and _question_key(price_question.question) == key:
        return True
    return any(
        question.affects_price and _question_key(question.question) == key
        for question in listing.buyer_questions
    )


CHANGE_FACT_LABELS = {
    "condition": "Condition",
    "flaws": "Flaws",
    "brand_model": "Brand and model",
    "accessories": "Included accessories",
}


def facts_from_changes(changes: ListingChanges | None) -> list[str]:
    if changes is None:
        return []
    facts: list[str] = []
    for field, label in CHANGE_FACT_LABELS.items():
        value = getattr(changes, field)
        if value is None:
            continue
        text = " ".join(value.split())
        facts.append(f"{label}: {text}" if text else f"{label}: none (seller cleared this)")
    return facts


def _fact_key(fact: str) -> str:
    """Facts about the same question or field replace each other instead of piling up."""
    head = fact.split("?", 1)[0] if "?" in fact else fact.split(":", 1)[0]
    return _question_key(head)


def merge_seller_facts(existing: list[str], new_facts: list[str]) -> list[str]:
    new_keys = {_fact_key(fact) for fact in new_facts}
    kept = [fact for fact in existing if _fact_key(fact) not in new_keys]
    return [*kept, *new_facts][-20:]


def active_price_after_reprice(
    suggestion,
    *,
    active_price: float,
    active_price_source: str | None,
    repriced: bool,
) -> float:
    """Manual prices are never changed; a picked tier follows the new suggestion for that tier."""
    if active_price_source == "manual":
        return active_price
    if not repriced and active_price > 0:
        return active_price
    tiers = {
        "ai_fast_sale": suggestion.fast_sale_price,
        "ai_high_ask": suggestion.high_ask_price,
        "ai_recommended": suggestion.recommended_price,
    }
    value = tiers.get(active_price_source or "ai_recommended") or 0
    return value or suggestion.recommended_price or suggestion.max or suggestion.min or active_price


def _without_answered_questions(listing: GeneratedListing, answered_keys: set[str], *, clear_all: bool) -> dict:
    price_question = listing.price_question
    if clear_all or (price_question is not None and _question_key(price_question.question) in answered_keys):
        price_question = None
    buyer_questions = (
        []
        if clear_all
        else [q for q in listing.buyer_questions if _question_key(q.question) not in answered_keys]
    )
    return {"price_question": price_question, "buyer_questions": buyer_questions}


def answers_need_ai(payload: ListingAnswersRequest) -> bool:
    if payload.dismiss:
        return False
    has_answers = any(answer.answer.strip() for answer in payload.answers)
    return has_answers or bool(payload.changes and payload.changes.has_changes())


async def answer_listing_record(
    item: dict,
    payload: ListingAnswersRequest,
    *,
    ai=None,
    update_analysis: Callable[..., Awaitable[object]],
    storage: Storage = storage_service,
) -> ListingAnswersResponse:
    """Apply the seller's answers or edits: re-price if needed, revise the description, clear questions."""
    item_id = item["id"]
    analysis = (
        VisionAnalysis.model_validate_json(item["analysis_json"])
        if item.get("analysis_json")
        else VisionAnalysis()
    )
    stored_listing = (
        GeneratedListing.model_validate_json(item["listing_json"])
        if item.get("listing_json")
        else None
    )
    listing = payload.listing or stored_listing
    if listing is None:
        raise HTTPException(status_code=400, detail="No listing is available to update")
    if stored_listing is not None:
        # The client sends its edited text; the open questions always come from the server copy.
        listing = listing.model_copy(
            update={
                "price_question": stored_listing.price_question,
                "buyer_questions": stored_listing.buyer_questions,
            }
        )

    answers = [answer for answer in payload.answers if answer.answer.strip()]
    answered_keys = {_question_key(answer.question) for answer in answers}
    changes = payload.changes if payload.changes and payload.changes.has_changes() else None
    repriced = False

    if answers_need_ai(payload):
        if ai is None:
            raise HTTPException(status_code=500, detail="AI provider is required to update the listing")
        new_facts = [f"{' '.join(answer.question.split())} {' '.join(answer.answer.split())}" for answer in answers]
        new_facts.extend(facts_from_changes(changes))
        reprice = any(answer_affects_price(answer, listing) for answer in answers) or changes is not None

        analysis_update: dict = {"seller_facts": merge_seller_facts(analysis.seller_facts, new_facts)}
        if changes is not None and changes.condition:
            analysis_update["condition"] = normalize_condition(changes.condition) or changes.condition
        analysis = analysis.model_copy(update=analysis_update)

        try:
            listing = await ai.revise_listing(
                listing,
                analysis=analysis,
                new_facts=new_facts,
                reprice=reprice,
            )
        except Exception as exc:
            if isinstance(exc, PROVIDER_NOT_CONFIGURED_ERRORS):
                ensure_ai_provider_configured()
                raise provider_not_configured_error() from exc
            if isinstance(exc, AIProviderCredentialInvalidError):
                raise provider_credential_invalid_error(ai) from exc
            if isinstance(exc, PROVIDER_CLIENT_ERRORS):
                logger.warning("Listing answers update failed for %s: %s", item_id, exc)
                raise HTTPException(status_code=502, detail="Could not update the listing right now") from exc
            raise
        repriced = reprice

    question_update = _without_answered_questions(listing, answered_keys, clear_all=payload.dismiss)
    listing = listing.model_copy(update=question_update)
    analysis = analysis.model_copy(update=question_update)

    feedback = await image_feedback_for_paths(
        item_image_paths(item), item_id, storage=storage, skip_paths=video_cover_paths(item)
    )
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

    if answers or changes is not None or payload.dismiss:
        await update_analysis(
            item_id,
            analysis.model_dump(),
            listing.model_dump(),
            status=item.get("status") or "analyzed",
            user_id=item["user_id"],
        )

    return ListingAnswersResponse(
        item_id=item_id,
        listing=listing,
        analysis=analysis,
        missing_checklist=checklist,
        repriced=repriced,
        active_price=active_price_after_reprice(
            listing.price_suggestion,
            active_price=payload.active_price,
            active_price_source=payload.active_price_source,
            repriced=repriced,
        ),
        active_price_source=payload.active_price_source,
    )


def notion_video_for_item(
    item: dict,
    previous_media: dict,
    *,
    storage: Storage = storage_service,
) -> NotionVideo | None:
    """The item's video as Notion input, reusing the earlier Notion upload of the same video."""
    video = item_video_record(item)
    if not video:
        return None
    path = str(video["path"])
    video_id = str(video.get("id") or path)
    same_video = previous_media.get("video_id") == video_id
    extension = path.rsplit(".", 1)[-1] if "." in path else "mp4"

    async def load() -> bytes:
        return (await storage.read(path)).content

    return NotionVideo(
        video_id=video_id,
        filename=f"video.{extension}",
        content_type=str(video.get("content_type") or "video/mp4"),
        size_bytes=int(video.get("size_bytes") or 0),
        duration_seconds=float(video.get("duration_seconds") or 0),
        load=load,
        cached_upload_id=previous_media.get("file_upload_id") if same_video else None,
        previously_too_large=same_video and bool(previous_media.get("too_large")),
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

    previous_media = item_notion_media(claimed_item)
    video = notion_video_for_item(claimed_item, previous_media, storage=storage)
    entry_kwargs: dict = {}
    if video is not None or previous_media.get("video_id"):
        entry_kwargs = {"video": video, "had_video": bool(previous_media.get("video_id"))}
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
            **entry_kwargs,
        )
        if result is None:
            finished = await finish_or_refresh(
                sync_status="not_synced",
                last_error=None,
            )
        else:
            warnings = list(getattr(result, "warnings", ()) or ())
            finished = await finish_or_refresh(
                sync_status="synced",
                page_id=result.page_id,
                page_url=result.page_url,
                succeeded=True,
                last_error=None,
                media={
                    "video_id": video.video_id if video else None,
                    "file_upload_id": getattr(result, "video_upload_id", None) if video else None,
                    "warning": warnings[0] if warnings else None,
                    "too_large": bool(video) and VIDEO_TOO_LARGE_WARNING in warnings,
                },
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
    feedback = await image_feedback_for_paths(
        item_image_paths(item), item_id, storage=storage, skip_paths=video_cover_paths(item)
    )
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
    feedback = await image_feedback_for_paths(
        item_image_paths(item), item_id, storage=storage, skip_paths=video_cover_paths(item)
    )
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
    feedback = await image_feedback_for_paths(
        item_image_paths(item), item_id, storage=storage, skip_paths=video_cover_paths(item)
    )
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
        video=item_video_payload(item),
        created_at=datetime.fromisoformat(item["created_at"]),
        updated_at=datetime.fromisoformat(item["updated_at"]),
    )
