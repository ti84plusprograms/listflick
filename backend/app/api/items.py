import logging
import time

from fastapi import APIRouter, Depends, File, Header, HTTPException, Response, UploadFile

from app.models.database import (
    create_item,
    claim_item_upload,
    claim_item_notion_sync,
    claim_analysis_job,
    complete_analysis_job,
    complete_item_upload,
    finish_item_notion_sync,
    delete_item,
    get_item,
    get_analysis_job,
    item_image_paths,
    fail_analysis_job,
    ensure_succeeded_analysis_job,
    update_item_analysis,
    update_item_images,
    update_item_notion_sync,
    list_expired_trashed_items,
    list_expired_pending_items,
    restore_item,
    trash_item,
)
from app.schemas.listing import (
    AnalyzeRequest,
    AnalyzeResponse,
    AnalysisJobResponse,
    ImproveListingRequest,
    ImproveListingResponse,
    ItemResponse,
    SaveListingRequest,
    SaveListingResponse,
    NotionSyncRequest,
    TrashRequest,
    UploadResponse,
)
from app.services.ai_credentials import AI_CREDENTIAL_HEADER, AI_PROVIDER_HEADER
from app.services.analyze_service import (
    analyze_item_record,
    ensure_ai_provider_configured,
    improve_listing_record,
    item_response_from_record,
    retry_notion_sync_record,
    save_item_record,
)
from app.auth import get_current_user
from app.services.item_api_service import (
    cleanup_expired_trashed_items,
    create_pending_upload,
    discard_pending_item,
    image_response,
    permanently_delete_trashed_item,
    replace_item_image_set,
    require_owned_item,
    restore_owned_item,
    save_listing_with_pending_images,
    signed_image_url,
    trash_owned_item,
)
from app.services.notion_service import notion_service
from app.services.resumable_analysis import analysis_job_status, execute_resumable_analysis
from app.services.storage import storage_service

router = APIRouter(prefix="/api/items", tags=["items"])
logger = logging.getLogger("uvicorn.error")


@router.post("/upload", response_model=UploadResponse)
async def upload_image(
    file: UploadFile = File(...),
    uid: str = Depends(get_current_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    logger.info("POST /api/items/upload called by user uid=%s", uid)
    return await upload_images([file], uid=uid, idempotency_key=idempotency_key)


@router.post("/upload-multiple", response_model=UploadResponse)
async def upload_images(
    files: list[UploadFile] = File(...),
    uid: str = Depends(get_current_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    if not isinstance(idempotency_key, str):
        idempotency_key = None
    if idempotency_key is not None:
        if not 8 <= len(idempotency_key) <= 128 or not all(
            character.isalnum() or character in "._:-" for character in idempotency_key
        ):
            raise HTTPException(status_code=400, detail="Invalid Idempotency-Key")
    logger.info("POST /api/items/upload-multiple called by user uid=%s with %d file(s)", uid, len(files))
    return await create_pending_upload(
        files,
        uid,
        create_item_record=create_item,
        update_images=update_item_images,
        delete_item_record=delete_item,
        storage=storage_service,
        client_request_id=idempotency_key,
        claim_upload=claim_item_upload,
        complete_upload=complete_item_upload,
    )


@router.put("/{item_id}/images", response_model=UploadResponse)
async def replace_item_images(item_id: str, files: list[UploadFile] = File(...), uid: str = Depends(get_current_user)):
    logger.info("PUT /api/items/%s/images called by uid=%s with %d replacement file(s)", item_id, uid, len(files))
    try:
        item = await require_owned_item(item_id, uid, get_item_record=get_item)
    except HTTPException:
        logger.warning("Replace images failed: Item %s not found for uid=%s", item_id, uid)
        raise
    return await replace_item_image_set(
        item_id,
        files,
        uid,
        item=item,
        update_images=update_item_images,
        storage=storage_service,
    )


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_item(payload: AnalyzeRequest, uid: str = Depends(get_current_user), ai_key: str | None = Header(default=None, alias=AI_CREDENTIAL_HEADER), ai_provider: str | None = Header(default=None, alias=AI_PROVIDER_HEADER)):
    start = time.perf_counter()
    item_id = payload.item_id

    request_ai, credential = ensure_ai_provider_configured(ai_key if isinstance(ai_key, str) else None, ai_provider)

    logger.info(
        "POST /api/items/analyze requested for item_id=%s (uid=%s, provider=%s, credential_source=%s)",
        item_id,
        uid,
        credential.provider,
        credential.source,
    )

    try:
        item = await require_owned_item(item_id, uid, get_item_record=get_item)
    except HTTPException:
        logger.warning("Analyze item failed: Item %s not found for uid=%s", item_id, uid)
        raise

    response = await analyze_item_record(
        item,
        ai=request_ai,
        update_analysis=update_item_analysis,
        storage=storage_service,
    )
    logger.info("AI Analysis completed for item_id=%s (uid=%s) in %.2fs", item_id, uid, time.perf_counter() - start)
    return response


@router.post("/{item_id}/analysis-jobs", response_model=AnalysisJobResponse)
async def start_or_resume_analysis(
    item_id: str,
    response: Response,
    uid: str = Depends(get_current_user),
    ai_key: str | None = Header(default=None, alias=AI_CREDENTIAL_HEADER),
    ai_provider: str | None = Header(default=None, alias=AI_PROVIDER_HEADER),
):
    start = time.perf_counter()
    item = await require_owned_item(item_id, uid, get_item_record=get_item)
    if item.get("analysis_json") and item.get("listing_json"):
        completed = await ensure_succeeded_analysis_job(item_id, uid)
        logger.info("Analysis job for item_id=%s already succeeded (uid=%s)", item_id, uid)
        return AnalysisJobResponse(job=analysis_job_status(completed))
    request_ai, credential = ensure_ai_provider_configured(ai_key if isinstance(ai_key, str) else None, ai_provider)
    logger.info(
        "POST /api/items/%s/analysis-jobs started (uid=%s, provider=%s, credential_source=%s)",
        item_id,
        uid,
        credential.provider,
        credential.source,
    )
    job = await execute_resumable_analysis(
        item,
        claim_job=claim_analysis_job,
        complete_job=complete_analysis_job,
        fail_job=fail_analysis_job,
        ai=request_ai,
        storage=storage_service,
    )
    if job.status in {"queued", "processing"}:
        response.status_code = 202
    logger.info(
        "Analysis job for item_id=%s ended status=%s in %.2fs (provider=%s, credential_source=%s)",
        item_id,
        job.status,
        time.perf_counter() - start,
        credential.provider,
        credential.source,
    )
    return AnalysisJobResponse(job=job)


@router.get("/{item_id}/analysis-jobs", response_model=AnalysisJobResponse)
async def get_analysis_job_status(
    item_id: str,
    uid: str = Depends(get_current_user),
):
    item = await require_owned_item(item_id, uid, get_item_record=get_item)
    if item.get("analysis_json") and item.get("listing_json"):
        record = await ensure_succeeded_analysis_job(item_id, uid)
    else:
        record = await get_analysis_job(item_id, uid)
    if not record:
        raise HTTPException(status_code=404, detail="Analysis job not found")
    return AnalysisJobResponse(job=analysis_job_status(record))


@router.post("/improve", response_model=ImproveListingResponse)
async def improve_listing(payload: ImproveListingRequest, uid: str = Depends(get_current_user), ai_key: str | None = Header(default=None, alias=AI_CREDENTIAL_HEADER), ai_provider: str | None = Header(default=None, alias=AI_PROVIDER_HEADER)):
    start = time.perf_counter()
    request_ai, credential = ensure_ai_provider_configured(ai_key if isinstance(ai_key, str) else None, ai_provider)

    logger.info(
        "POST /api/items/improve requested (item_id=%s, action=%s, uid=%s, provider=%s, credential_source=%s)",
        payload.item_id,
        payload.action,
        uid,
        credential.provider,
        credential.source,
    )

    item = None
    if payload.item_id:
        try:
            item = await require_owned_item(payload.item_id, uid, get_item_record=get_item)
        except HTTPException:
            logger.warning("Improve listing failed: Item %s not found for uid=%s", payload.item_id, uid)
            raise

    response = await improve_listing_record(payload, item, ai=request_ai)
    logger.info("Improve listing completed for item_id=%s in %.2fs", payload.item_id, time.perf_counter() - start)
    return response


@router.post("/{item_id}/save", response_model=SaveListingResponse)
async def save_item_listing(item_id: str, payload: SaveListingRequest, uid: str = Depends(get_current_user)):
    start = time.perf_counter()
    logger.info("POST /api/items/%s/save requested (uid=%s, title='%s')", item_id, uid, payload.title)
    try:
        item = await require_owned_item(item_id, uid, get_item_record=get_item)
    except HTTPException:
        logger.warning("Save listing failed: Item %s not found for uid=%s", item_id, uid)
        raise
    response = await save_listing_with_pending_images(
        item_id,
        uid,
        item=item,
        payload=payload,
        save_record=save_item_record,
        get_item_record=get_item,
        update_images=update_item_images,
        update_analysis=update_item_analysis,
        update_notion_sync=update_item_notion_sync,
        claim_notion_sync=claim_item_notion_sync,
        finish_notion_sync=finish_item_notion_sync,
        notion=notion_service,
        storage=storage_service,
    )
    logger.info("Saved listing edits for item_id=%s in %.2fs (sync_status=%s)", item_id, time.perf_counter() - start, response.notion_sync.status)
    return response


@router.post("/{item_id}/notion/retry", response_model=SaveListingResponse)
async def retry_item_notion_sync(
    item_id: str,
    payload: NotionSyncRequest | None = None,
    uid: str = Depends(get_current_user),
):
    start = time.perf_counter()
    logger.info("POST /api/items/%s/notion/retry requested by uid=%s", item_id, uid)
    try:
        item = await require_owned_item(item_id, uid, get_item_record=get_item)
    except HTTPException:
        logger.warning("Notion sync retry failed: Item %s not found for uid=%s", item_id, uid)
        raise

    response = await retry_notion_sync_record(
        item,
        notion=notion_service,
        get_item_record=lambda id: get_item(id, uid),
        update_notion_sync=update_item_notion_sync,
        claim_notion_sync=claim_item_notion_sync,
        finish_notion_sync=finish_item_notion_sync,
        storage=storage_service,
        notion_sync_enabled=payload.notion_sync_enabled if payload else None,
    )
    logger.info("Retried Notion sync for item_id=%s in %.2fs (result_status=%s)", item_id, time.perf_counter() - start, response.notion_sync.status)
    return response


@router.post("/{item_id}/trash")
async def trash_item_endpoint(
    item_id: str,
    payload: TrashRequest,
    uid: str = Depends(get_current_user),
):
    item = await require_owned_item(item_id, uid, get_item_record=get_item)
    return await trash_owned_item(item_id, payload, uid, item=item, trash_item_record=trash_item)


@router.post("/{item_id}/restore")
async def restore_item_endpoint(item_id: str, uid: str = Depends(get_current_user)):
    item = await require_owned_item(item_id, uid, get_item_record=get_item, detail="Trashed item not found")
    return await restore_owned_item(item_id, uid, item=item, restore_item_record=restore_item)


@router.delete("/{item_id}")
async def permanently_delete_item(item_id: str, uid: str = Depends(get_current_user)):
    item = await require_owned_item(item_id, uid, get_item_record=get_item, detail="Trashed item not found")
    return await permanently_delete_trashed_item(
        item_id,
        uid,
        item=item,
        delete_item_record=delete_item,
        storage=storage_service,
    )


@router.delete("/{item_id}/draft")
async def discard_item_draft(item_id: str, uid: str = Depends(get_current_user)):
    item = await require_owned_item(item_id, uid, get_item_record=get_item)
    return await discard_pending_item(
        item_id,
        uid,
        item=item,
        delete_item_record=delete_item,
        storage=storage_service,
    )


@router.post("/cleanup")
async def cleanup_expired_items(uid: str = Depends(get_current_user)):
    result = await cleanup_expired_trashed_items(
        uid,
        list_expired_items=list_expired_trashed_items,
        delete_item_record=delete_item,
        storage=storage_service,
    )
    pending_purged = 0
    for item in await list_expired_pending_items(uid):
        await delete_item(item["id"], uid)
        try:
            await storage_service.delete_pending(item_image_paths(item))
        except Exception:
            logger.warning("Expired pending item left orphaned storage item_id=%s", item["id"], exc_info=True)
        pending_purged += 1
    return {**result, "pending_purged": pending_purged}


@router.get("/{item_id}", response_model=ItemResponse)
async def get_item_by_id(item_id: str, uid: str = Depends(get_current_user)):
    logger.info("GET /api/items/%s requested by uid=%s", item_id, uid)
    try:
        item = await require_owned_item(item_id, uid, get_item_record=get_item)
    except HTTPException:
        logger.warning("Fetch item failed: Item %s not found for uid=%s", item_id, uid)
        raise
    job_record = await get_analysis_job(item_id, uid)
    job = analysis_job_status(job_record) if job_record else None
    return await item_response_from_record(item, storage=storage_service, analysis_job=job)


@router.get("/{item_id}/image")
@router.head("/{item_id}/image")
async def get_item_image(item_id: str, uid: str = Depends(get_current_user)):
    return await get_item_image_by_index(item_id, 0, uid=uid)


@router.get("/{item_id}/image/{image_index}/url")
async def get_item_image_url(item_id: str, image_index: int, uid: str = Depends(get_current_user)):
    """Return a short-lived private Storage URL after checking item ownership."""
    logger.info("GET /api/items/%s/image/%d/url requested by uid=%s", item_id, image_index, uid)
    item = await require_owned_item(item_id, uid, get_item_record=get_item)
    return await signed_image_url(item_id, image_index, item=item, storage=storage_service)


@router.get("/{item_id}/image/{image_index}")
@router.head("/{item_id}/image/{image_index}")
async def get_item_image_by_index(item_id: str, image_index: int, uid: str = Depends(get_current_user)):
    logger.info("GET /api/items/%s/image/%d requested by uid=%s", item_id, image_index, uid)
    try:
        item = await require_owned_item(item_id, uid, get_item_record=get_item)
    except HTTPException:
        logger.warning("Fetch image failed: Item %s not found for uid=%s", item_id, uid)
        raise
    return await image_response(item_id, image_index, item=item, storage=storage_service)
