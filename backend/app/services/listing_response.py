"""Response normalization shared by listing workflows."""

import logging

from app.models.database import item_notion_media
from app.schemas.listing import (
    ChecklistItem,
    GeneratedListing,
    ImageQualityFeedback,
    NotionSyncStatus,
    SaveListingResponse,
    VisionAnalysis,
)
from app.services.image_service import build_image_quality_feedback
from app.services.listing_quality import listing_with_quality
from app.services.notion_status import notion_capability, notion_error_code_from_message
from app.services.storage import Storage, StorageError, storage_service

logger = logging.getLogger("uvicorn.error")


def notion_sync_from_item(item: dict, *, reason: str | None = None) -> NotionSyncStatus:
    status = item.get("notion_sync_status") or "not_synced"
    media_warning = item_notion_media(item).get("warning") if status == "synced" else None
    last_error = item.get("notion_last_error")
    if reason is None:
        reason = item.get("notion_sync_reason")
    if reason is None and status == "not_synced":
        capability_reason = notion_capability()["reason"]
        reason = capability_reason if capability_reason != "configured" else None
    return NotionSyncStatus.model_validate({
        "status": status,
        "reason": reason,
        "error_code": notion_error_code_from_message(last_error) if status == "failed" else None,
        "page_id": item.get("notion_page_id"),
        "page_url": item.get("notion_page_url"),
        "last_attempt_at": item.get("notion_last_attempt_at"),
        "last_success_at": item.get("notion_last_success_at"),
        "last_error": last_error,
        "warnings": [media_warning] if isinstance(media_warning, str) and media_warning else [],
    })


def quality_listing(
    analysis: VisionAnalysis | None,
    listing: GeneratedListing,
    *,
    missing_checklist: list | None = None,
    image_quality_feedback: list | None = None,
) -> GeneratedListing:
    checklist_models = [
        item if isinstance(item, ChecklistItem) else ChecklistItem(**item)
        for item in (missing_checklist or [])
    ]
    feedback_models = [
        item if isinstance(item, ImageQualityFeedback) else ImageQualityFeedback(**item)
        for item in (image_quality_feedback or [])
    ]
    return listing_with_quality(
        analysis,
        listing,
        missing_checklist=checklist_models,
        image_quality_feedback=feedback_models,
    )


def save_listing_response(
    item_id: str,
    listing: GeneratedListing,
    checklist: list,
    feedback: list,
    notion_sync: NotionSyncStatus,
) -> SaveListingResponse:
    return SaveListingResponse(
        item_id=item_id,
        notion_page_id=notion_sync.page_id,
        notion_synced=notion_sync.status == "synced",
        notion_sync=notion_sync,
        listing=listing,
        missing_checklist=checklist,
        image_quality_feedback=feedback,
    )


async def image_feedback_for_paths(
    paths: list[str],
    item_id: str,
    *,
    storage: Storage = storage_service,
    skip_paths: set[str] | None = None,
) -> list[dict]:
    """Per-photo quality feedback. ``skip_paths`` (a cover taken from the video) get none."""
    feedback_items: list[dict] = []
    for index, raw_path in enumerate(paths):
        if skip_paths and raw_path in skip_paths:
            continue
        try:
            asset = await storage.read(raw_path)
            feedback, _ = build_image_quality_feedback(
                asset.content,
                image_id=f"{item_id}:{index}",
                image_index=index,
            )
            feedback_items.append(feedback)
        except StorageError:
            logger.warning("Could not build image quality feedback for %s", raw_path, exc_info=True)
    return feedback_items
