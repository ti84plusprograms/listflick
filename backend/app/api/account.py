"""Authenticated account lifecycle endpoints."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from firebase_admin import auth as firebase_auth

from app.auth import get_current_user
from app.models.database import delete_items_for_user, list_items
from app.services.account_deletion import delete_user_data
from app.services.storage import storage_service
from app.services.storage_contract import StorageError

router = APIRouter(prefix="/api/account", tags=["account"])
logger = logging.getLogger("uvicorn.error")


@router.delete("")
async def delete_account(uid: str = Depends(get_current_user)) -> dict[str, bool | int]:
    """Delete the authenticated user's server data and Firebase account."""
    logger.info("DELETE /api/account requested by uid=%s", uid)
    try:
        item_count = await delete_user_data(
            uid,
            list_items=list_items,
            delete_items=delete_items_for_user,
            storage=storage_service,
        )
    except StorageError as exc:
        logger.warning("Account deletion storage cleanup failed uid=%s code=%s", uid, exc.code.value)
        raise HTTPException(status_code=502, detail="Could not delete account images") from exc
    except Exception as exc:
        logger.error("Account deletion data cleanup failed uid=%s error_type=%s", uid, type(exc).__name__)
        raise HTTPException(status_code=500, detail="Could not delete account data") from exc

    try:
        await asyncio.to_thread(firebase_auth.delete_user, uid)
    except Exception as exc:
        logger.error("Firebase account deletion failed uid=%s error_type=%s", uid, type(exc).__name__)
        raise HTTPException(status_code=502, detail="Could not delete the authentication account") from exc

    logger.info("Account deletion completed uid=%s item_count=%d", uid, item_count)
    return {"deleted": True, "deleted_item_count": item_count}
