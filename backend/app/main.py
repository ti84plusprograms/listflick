from contextlib import asynccontextmanager
import json
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.account import router as account_router
from app.api.items import router as items_router
from app.api.recheck import router as recheck_router
from app.config import settings
from app.utils.body_limit import VideoUploadSizeLimitMiddleware
from app.models.database import (
    delete_item,
    init_db,
    item_image_paths,
    item_video_paths,
    list_active_pending_paths,
    list_expired_pending_items,
)
from app.services.storage import storage_service
from app.services.notion_status import notion_capability

logger = logging.getLogger("uvicorn.error")


import firebase_admin
from firebase_admin import credentials

@asynccontextmanager
async def lifespan(app: FastAPI):
    if not firebase_admin._apps:
        if settings.firebase_service_account_path and os.path.exists(settings.firebase_service_account_path):
            firebase_admin.initialize_app(credentials.Certificate(settings.firebase_service_account_path))
        elif os.path.exists("service-account.json"):
            firebase_admin.initialize_app(credentials.Certificate("service-account.json"))
        elif settings.firebase_service_account_json:
            try:
                service_account_info = json.loads(settings.firebase_service_account_json)
                if "private_key" in service_account_info:
                    service_account_info["private_key"] = service_account_info["private_key"].replace("\\n", "\n")
                firebase_admin.initialize_app(credentials.Certificate(service_account_info))
            except (TypeError, ValueError, json.JSONDecodeError) as exc:
                raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON is not valid service-account JSON") from exc
        else:
            firebase_admin.initialize_app()
    await init_db()
    expired_items = await list_expired_pending_items()
    for item in expired_items:
        await delete_item(item["id"], item["user_id"])
        try:
            await storage_service.delete_pending(item_image_paths(item))
            await storage_service.delete(item_video_paths(item))
        except Exception:
            logger.warning(
                "Expired pending item left orphaned storage item_id=%s",
                item["id"],
                exc_info=True,
            )
    protected_pending_paths = set(await list_active_pending_paths())
    cleanup = await storage_service.cleanup_pending(
        preserve_paths=protected_pending_paths,
    )
    logger.info("Storage pending cleanup completed scanned=%d deleted=%d failed=%d", cleanup["scanned"], cleanup["deleted"], cleanup["failed"])
    gemini_status = "CONFIGURED" if settings.gemini_api_key else "NOT CONFIGURED"
    groq_status = "CONFIGURED" if settings.groq_api_key else "NOT CONFIGURED"
    claude_status = "CONFIGURED" if settings.anthropic_api_key else "NOT CONFIGURED"
    fallback_status = "ENABLED" if settings.allow_server_ai_key_fallback else "DISABLED"
    logger.info(
        "AI Configuration: default_provider=%s | server_fallback=%s | gemini=%s | groq=%s | claude=%s",
        settings.ai_provider,
        fallback_status,
        gemini_status,
        groq_status,
        claude_status,
    )
    yield


app = FastAPI(
    title="ListFlick API",
    description="AI-powered listing generation for resale items",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(VideoUploadSizeLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(items_router)
app.include_router(recheck_router)
app.include_router(account_router)


@app.get("/health")
async def health():
    firebase_configured = bool(
        settings.firebase_service_account_json
        or (settings.firebase_service_account_path and os.path.exists(settings.firebase_service_account_path))
        or os.path.exists("service-account.json")
    )
    notion = notion_capability()
    logger.info(
        "GET /health: ai_provider=%s, fallback=%s, gemini_configured=%s, groq_configured=%s, claude_configured=%s",
        settings.ai_provider,
        settings.allow_server_ai_key_fallback,
        bool(settings.gemini_api_key),
        bool(settings.groq_api_key),
        bool(settings.anthropic_api_key),
    )
    return {
        "status": "ok",
        "ai_provider": settings.ai_provider,
        "allow_server_ai_key_fallback": settings.allow_server_ai_key_fallback,
        "firebase_service_account_configured": firebase_configured,
        "firebase_app_initialized": bool(firebase_admin._apps),
        "gemini_configured": bool(settings.gemini_api_key),
        "groq_configured": bool(settings.groq_api_key),
        "claude_configured": bool(settings.anthropic_api_key),
        "gemini_model": settings.gemini_model,
        "groq_vision_model": settings.groq_vision_model,
        "groq_vision_reasoning_effort": settings.groq_vision_reasoning_effort,
        "groq_text_model": settings.groq_text_model,
        "claude_vision_model": settings.claude_vision_model,
        "claude_text_model": settings.claude_text_model,
        "analysis_executor": "request_inline",
        "analysis_lease_seconds": settings.analysis_lease_seconds,
        "analysis_max_attempts": settings.analysis_max_attempts,
        "pending_item_retention_hours": settings.pending_item_retention_hours,
        "notion_configured": notion["configured"],
        "notion_client_override_allowed": settings.notion_allow_client_override,
        "notion_capability": notion,
    }
