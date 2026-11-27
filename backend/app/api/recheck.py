import logging
import time

from fastapi import APIRouter, Depends, Header, HTTPException

from app.auth import get_current_user
from app.models.database import get_item, item_image_paths
from app.schemas.recheck import RecheckListingRequest, RecheckListingResponse
from app.services.ai_credentials import AI_CREDENTIAL_HEADER, AI_PROVIDER_HEADER
from app.services.analyze_service import ensure_ai_provider_configured, image_assets_for_paths
from app.services.item_api_service import require_owned_item
from app.services.listing_recheck import MAX_RECHECK_IMAGES, recheck_listing_record
from app.services.storage import storage_service

router = APIRouter(prefix="/api/items", tags=["items"])
logger = logging.getLogger("uvicorn.error")


@router.post("/recheck", response_model=RecheckListingResponse)
async def recheck_listing(
    payload: RecheckListingRequest,
    uid: str = Depends(get_current_user),
    ai_key: str | None = Header(default=None, alias=AI_CREDENTIAL_HEADER),
    ai_provider: str | None = Header(default=None, alias=AI_PROVIDER_HEADER),
):
    start = time.perf_counter()
    request_ai, credential = ensure_ai_provider_configured(ai_key if isinstance(ai_key, str) else None, ai_provider)
    logger.info(
        "POST /api/items/recheck requested (item_id=%s, include_images=%s, tips=%d, uid=%s, provider=%s, credential_source=%s)",
        payload.item_id,
        payload.include_images,
        len(payload.tips),
        uid,
        credential.provider,
        credential.source,
    )

    images: list[bytes] = []
    if payload.item_id:
        try:
            item = await require_owned_item(payload.item_id, uid, get_item_record=get_item)
        except HTTPException:
            logger.warning("Listing re-check failed: Item %s not found for uid=%s", payload.item_id, uid)
            raise
        if payload.include_images:
            assets = await image_assets_for_paths(
                item_image_paths(item)[:MAX_RECHECK_IMAGES],
                storage=storage_service,
            )
            images = [asset.content for asset in assets]

    response = await recheck_listing_record(payload, images, ai=request_ai)
    logger.info("Listing re-check for item_id=%s finished in %.2fs", payload.item_id, time.perf_counter() - start)
    return response
