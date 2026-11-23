"""API-facing item orchestration helpers."""

from __future__ import annotations

import logging
import hashlib
import json
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, UploadFile
from fastapi.responses import Response

from app.models.database import item_image_paths
from app.schemas.listing import ImageQualityError as ImageQualityErrorSchema
from app.schemas.listing import SaveListingRequest, TrashRequest, UploadResponse
from app.services.image_service import ImageQualityError, validate_and_process
from app.services.storage import Storage, StorageError, StorageErrorCode

logger = logging.getLogger("uvicorn.error")

ItemRecord = dict[str, Any]
CreateItem = Callable[[str, str], Awaitable[ItemRecord]]
ClaimUpload = Callable[[str, str, str], Awaitable[tuple[ItemRecord, bool]]]
CompleteUpload = Callable[[str, str, list[str], list[dict[str, Any]]], Awaitable[None]]
GetItem = Callable[[str, str], Awaitable[ItemRecord | None]]
DeleteItem = Callable[[str, str], Awaitable[None]]
UpdateItemImages = Callable[[str, str, list[str], str | None], Awaitable[None]]
TrashItem = Callable[[str, str, str], Awaitable[None]]
RestoreItem = Callable[[str, str], Awaitable[None]]
ListExpiredTrashedItems = Callable[[str], Awaitable[list[ItemRecord]]]


@dataclass(frozen=True)
class ProcessedImageBatch:
    images: list[bytes]
    feedback: list[dict[str, Any]]
    fingerprint: str


def storage_http_exception(exc: StorageError, *, not_found_detail: str, fallback_detail: str) -> HTTPException:
    if exc.code == StorageErrorCode.NOT_FOUND or (
        exc.code == StorageErrorCode.DOWNLOAD_FAILED and not exc.retryable
    ):
        return HTTPException(status_code=404, detail=not_found_detail)
    if exc.code == StorageErrorCode.FORBIDDEN:
        return HTTPException(status_code=403, detail="Storage access denied")
    return HTTPException(status_code=503 if exc.retryable else 502, detail=fallback_detail)


async def process_uploaded_images(files: list[UploadFile]) -> ProcessedImageBatch:
    if not files:
        logger.warning("Upload attempt failed: No files provided")
        raise HTTPException(status_code=400, detail="At least one image is required")
    if len(files) > 8:
        logger.warning("Upload attempt failed: Too many files (%d > 8)", len(files))
        raise HTTPException(status_code=400, detail="Upload at most 8 images")

    logger.info("Processing %d uploaded image file(s)", len(files))
    processed_images: list[bytes] = []
    image_feedback: list[dict[str, Any]] = []
    for index, file in enumerate(files):
        if not file.content_type or not file.content_type.startswith("image/"):
            logger.warning("File index %d rejected: Content-Type '%s' is not an image", index, file.content_type)
            raise HTTPException(status_code=400, detail="Files must be images")

        raw = await file.read()
        if len(raw) > 10 * 1024 * 1024:
            logger.warning(
                "File index %d rejected: File size (%.2fMB) exceeds 10MB limit",
                index,
                len(raw) / (1024 * 1024),
            )
            raise HTTPException(status_code=400, detail="Each image must be under 10MB")

        try:
            processed, _, feedback = validate_and_process(raw, image_index=index)
        except ImageQualityError as exc:
            logger.warning("Image quality validation failed for file index %d: %s", index, str(exc))
            feedback = {**exc.feedback, "image_index": index} if exc.feedback else {}
            raise HTTPException(
                status_code=422,
                detail=ImageQualityErrorSchema(
                    detail=str(exc),
                    issues=exc.issues,
                    image_quality_feedback=[feedback] if feedback else [],
                ).model_dump(),
            ) from exc
        processed_images.append(processed)
        image_feedback.append(feedback)

    digest = hashlib.sha256()
    for image in processed_images:
        digest.update(len(image).to_bytes(8, "big"))
        digest.update(image)
    return ProcessedImageBatch(
        images=processed_images,
        feedback=image_feedback,
        fingerprint=digest.hexdigest(),
    )


def upload_response(
    item_id: str,
    image_count: int,
    image_feedback: list[dict[str, Any]],
    *,
    status: str = "uploaded",
) -> UploadResponse:
    for index, feedback in enumerate(image_feedback):
        feedback["image_id"] = f"{item_id}:{index}"

    return UploadResponse(
        item_id=item_id,
        image_url=f"/api/items/{item_id}/image",
        image_urls=[f"/api/items/{item_id}/image/{index}" for index in range(image_count)],
        image_quality_feedback=image_feedback,
        status=status,
    )


async def create_pending_upload(
    files: list[UploadFile],
    uid: str,
    *,
    create_item_record: CreateItem,
    update_images: UpdateItemImages,
    delete_item_record: DeleteItem,
    storage: Storage,
    client_request_id: str | None = None,
    claim_upload: ClaimUpload | None = None,
    complete_upload: CompleteUpload | None = None,
) -> UploadResponse:
    start = time.perf_counter()
    processed = await process_uploaded_images(files)

    created = True
    if client_request_id:
        if claim_upload is None or complete_upload is None:
            raise RuntimeError("Idempotent upload dependencies are not configured")
        item, created = await claim_upload(uid, client_request_id, processed.fingerprint)
        if item.get("upload_fingerprint") != processed.fingerprint:
            raise HTTPException(
                status_code=409,
                detail="Idempotency-Key was already used with different images",
            )
        if not created and item.get("status") != "uploading":
            existing_paths = item_image_paths(item)
            try:
                existing_feedback = json.loads(item.get("upload_feedback_json") or "[]")
            except json.JSONDecodeError:
                existing_feedback = []
            return upload_response(
                item["id"],
                len(existing_paths),
                existing_feedback,
                status="uploaded",
            )
    else:
        item = await create_item_record("", uid)
    item_id = item["id"]
    logger.info("Created new item record %s for user uid=%s", item_id, uid)

    image_paths: list[str] = []
    try:
        image_paths = await storage.stage_pending(
            item_id,
            processed.images,
            # Idempotent claims use deterministic paths shared by retries and
            # concurrent same-key requests. Replacing those paths is safe
            # because the processed-image fingerprint was already verified.
            replace_existing=client_request_id is not None,
        )
        if client_request_id:
            assert complete_upload is not None
            await complete_upload(item_id, uid, image_paths, processed.feedback)
        else:
            await update_images(item_id, uid, image_paths, "pending")
    except Exception as exc:
        logger.error("Failed to upload/store images for item %s: %s", item_id, exc, exc_info=True)
        try:
            if not client_request_id:
                await storage.delete_pending(image_paths)
                await delete_item_record(item_id, uid)
            # Idempotent uploads share these deterministic paths with retries
            # and concurrent same-key requests. Preserve staged objects when
            # the database completion write fails so a retry can safely upsert
            # and commit them instead of racing a destructive compensation.
        except Exception:
            logger.warning("Could not compensate failed upload for %s", item_id, exc_info=True)
        if isinstance(exc, StorageError):
            raise HTTPException(status_code=502, detail="Could not store image") from exc
        raise HTTPException(status_code=500, detail="Could not save uploaded image") from exc

    elapsed = time.perf_counter() - start
    logger.info(
        "Image upload/process completed for item_id=%s (%d image%s) for uid=%s in %.2fs",
        item_id,
        len(image_paths),
        "" if len(image_paths) == 1 else "s",
        uid,
        elapsed,
    )
    return upload_response(item_id, len(image_paths), processed.feedback)


async def require_owned_item(
    item_id: str,
    uid: str,
    *,
    get_item_record: GetItem,
    detail: str = "Item not found",
) -> ItemRecord:
    item = await get_item_record(item_id, uid)
    if not item:
        raise HTTPException(status_code=404, detail=detail)
    return item


async def replace_item_image_set(
    item_id: str,
    files: list[UploadFile],
    uid: str,
    *,
    item: ItemRecord,
    update_images: UpdateItemImages,
    storage: Storage,
) -> UploadResponse:
    start = time.perf_counter()
    processed = await process_uploaded_images(files)
    replacement_id = uuid.uuid4().hex
    new_paths: list[str] = []

    use_pending_storage = item.get("image_storage_state") == "pending"
    try:
        for index, image in enumerate(processed.images):
            if use_pending_storage:
                continue
            object_name = f"{item_id}/{item_id}-{replacement_id}-{index + 1}.jpg"
            await storage.upload(object_name, image)
            new_paths.append(object_name)
        if use_pending_storage:
            new_paths = await storage.stage_pending(f"{item_id}-{replacement_id}", processed.images)
            await update_images(item_id, uid, new_paths, "pending")
        else:
            await update_images(item_id, uid, new_paths, "permanent")
    except Exception as exc:
        logger.error("Failed to store replacement images for item %s: %s", item_id, exc, exc_info=True)
        try:
            if use_pending_storage:
                await storage.delete_pending(new_paths)
            else:
                await storage.delete(new_paths)
        except Exception:
            logger.warning("Could not compensate failed replacement for %s", item_id, exc_info=True)
        if isinstance(exc, StorageError):
            raise HTTPException(status_code=502, detail="Could not store replacement image") from exc
        raise HTTPException(status_code=500, detail="Could not save replacement image") from exc

    old_paths = item_image_paths(item)
    if old_paths:
        try:
            if use_pending_storage:
                await storage.delete_pending(old_paths)
            else:
                await storage.delete(old_paths)
            logger.info("Cleaned up %d old image(s) for item %s", len(old_paths), item_id)
        except StorageError:
            logger.warning("Could not remove superseded images %s for item %s", old_paths, item_id, exc_info=True)

    logger.info("Successfully replaced images for item %s (uid=%s) in %.2fs", item_id, uid, time.perf_counter() - start)
    return upload_response(item_id, len(new_paths), processed.feedback)


async def save_listing_with_pending_images(
    item_id: str,
    uid: str,
    *,
    item: ItemRecord,
    payload: SaveListingRequest,
    save_record: Callable[..., Awaitable[Any]],
    get_item_record: GetItem,
    update_images: UpdateItemImages,
    update_analysis: Callable[..., Awaitable[None]],
    update_notion_sync: Callable[..., Awaitable[None]],
    claim_notion_sync: Callable[..., Awaitable[tuple[dict, str | None]]],
    finish_notion_sync: Callable[..., Awaitable[dict]],
    notion: Any,
    storage: Storage,
) -> Any:
    pending_paths = item_image_paths(item) if item.get("image_storage_state") == "pending" else []
    promoted_paths: list[str] = []
    try:
        if pending_paths:
            promoted_paths = await storage.promote_pending(item_id, pending_paths)
            await update_images(item_id, uid, promoted_paths, "permanent")
            item = await get_item_record(item_id, uid) or item

        response = await save_record(
            item,
            payload,
            notion=notion,
            get_item_record=lambda id: get_item_record(id, uid),
            update_analysis=update_analysis,
            update_notion_sync=update_notion_sync,
            claim_notion_sync=claim_notion_sync,
            finish_notion_sync=finish_notion_sync,
            storage=storage,
        )
        if pending_paths:
            await storage.delete_pending(pending_paths)
        return response
    except Exception:
        if promoted_paths:
            try:
                await storage.delete(promoted_paths)
                await update_images(item_id, uid, pending_paths, "pending")
            except Exception:
                logger.warning("Could not roll back promoted images for %s", item_id, exc_info=True)
        raise


async def trash_owned_item(
    item_id: str,
    payload: TrashRequest,
    uid: str,
    *,
    item: ItemRecord,
    trash_item_record: TrashItem,
) -> dict[str, str]:
    if item.get("status") == "trashed":
        raise HTTPException(status_code=409, detail="Item is already in Recently Deleted")

    now = datetime.now(timezone.utc)
    purge_at = now + timedelta(days=payload.retention_days)
    try:
        await trash_item_record(item_id, uid, purge_at.isoformat())
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Item not found") from exc
    return {"item_id": item_id, "deleted_at": now.isoformat(), "purge_at": purge_at.isoformat()}


async def restore_owned_item(
    item_id: str,
    uid: str,
    *,
    item: ItemRecord,
    restore_item_record: RestoreItem,
) -> dict[str, str]:
    if item.get("status") != "trashed":
        raise HTTPException(status_code=404, detail="Trashed item not found")
    try:
        await restore_item_record(item_id, uid)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Trashed item not found") from exc
    return {"item_id": item_id, "status": "saved"}


async def permanently_delete_trashed_item(
    item_id: str,
    uid: str,
    *,
    item: ItemRecord,
    delete_item_record: DeleteItem,
    storage: Storage,
) -> dict[str, bool | str]:
    if item.get("status") != "trashed":
        raise HTTPException(status_code=404, detail="Trashed item not found")
    try:
        await storage.delete(item_image_paths(item))
        await delete_item_record(item_id, uid)
    except StorageError as exc:
        raise HTTPException(status_code=502, detail="Could not permanently delete images") from exc
    return {"item_id": item_id, "deleted": True}


async def discard_pending_item(
    item_id: str,
    uid: str,
    *,
    item: ItemRecord,
    delete_item_record: DeleteItem,
    storage: Storage,
) -> dict[str, str | bool]:
    if item.get("status") in {"saved", "trashed"}:
        raise HTTPException(status_code=409, detail="Saved items cannot be discarded as pending work")
    paths = item_image_paths(item)
    await delete_item_record(item_id, uid)
    try:
        if item.get("image_storage_state") == "pending":
            await storage.delete_pending(paths)
        else:
            await storage.delete(paths)
    except StorageError:
        logger.warning("Pending item storage cleanup left orphaned paths item_id=%s", item_id, exc_info=True)
    return {"item_id": item_id, "discarded": True}


async def cleanup_expired_trashed_items(
    uid: str,
    *,
    list_expired_items: ListExpiredTrashedItems,
    delete_item_record: DeleteItem,
    storage: Storage,
) -> dict[str, int]:
    expired = await list_expired_items(uid)
    purged = 0
    for item in expired:
        try:
            await storage.delete(item_image_paths(item))
            await delete_item_record(item["id"], uid)
            purged += 1
        except StorageError:
            logger.warning("Could not purge expired item %s", item["id"], exc_info=True)
    return {"purged": purged}


def select_item_image_path(item: ItemRecord, image_index: int) -> str:
    paths = item_image_paths(item)
    if image_index < 0 or image_index >= len(paths):
        raise HTTPException(status_code=404, detail="Image not found")
    return paths[image_index]


async def signed_image_url(
    item_id: str,
    image_index: int,
    *,
    item: ItemRecord,
    storage: Storage,
) -> dict[str, int | str | None]:
    object_name = select_item_image_path(item, image_index)
    try:
        url = await storage.signed_url(object_name, expires_in=3600)
    except StorageError as exc:
        logger.warning(
            "Image URL generation failed item_id=%s image_index=%d object_path=%s",
            item_id,
            image_index,
            object_name,
            exc_info=True,
        )
        raise storage_http_exception(
            exc,
            not_found_detail="Image not found in storage",
            fallback_detail="Image URL temporarily unavailable",
        ) from exc

    logger.info(
        "Image URL generation completed item_id=%s image_index=%d has_url=%s",
        item_id,
        image_index,
        bool(url),
    )
    return {"url": url, "expires_in": 3600 if url else 0}


async def image_response(
    item_id: str,
    image_index: int,
    *,
    item: ItemRecord,
    storage: Storage,
) -> Response:
    paths = item_image_paths(item)
    logger.info(
        "Image retrieval item found item_id=%s storage_state=%s image_count=%d",
        item_id,
        item.get("image_storage_state"),
        len(paths),
    )
    if image_index < 0 or image_index >= len(paths):
        logger.warning("Fetch image failed: Invalid image index %d for item %s (total paths=%d)", image_index, item_id, len(paths))
        raise HTTPException(status_code=404, detail="Image not found")

    object_name = paths[image_index]
    logger.info("Image retrieval selected item_id=%s image_index=%d object_path=%s", item_id, image_index, object_name)
    try:
        asset = await storage.read(object_name)
        logger.info(
            "Image retrieval returning image bytes item_id=%s image_index=%d bytes=%d content_type=%s",
            item_id,
            image_index,
            len(asset.content),
            asset.content_type,
        )
        return Response(
            content=asset.content,
            media_type=asset.content_type,
            headers={"Cache-Control": "private, max-age=3600, immutable"},
        )
    except StorageError as exc:
        logger.warning(
            "Image retrieval storage failure item_id=%s image_index=%d object_path=%s",
            item_id,
            image_index,
            object_name,
            exc_info=True,
        )
        raise storage_http_exception(
            exc,
            not_found_detail="Image not found in storage",
            fallback_detail="Image temporarily unavailable",
        ) from exc
