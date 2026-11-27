import json
from unittest.mock import AsyncMock

import pytest

from app.models import database


@pytest.fixture(autouse=True)
def temp_db(monkeypatch, tmp_path):
    """
    Global test fixture that mocks all database operations in memory.
    This prevents tests from hitting the real Postgres/Supabase database.
    """
    from app.config import settings
    monkeypatch.setattr(settings, "allow_server_ai_key_fallback", True)
    _mock_db = {}
    _analysis_jobs = {}

    async def mock_init_db():
        pass

    async def mock_close_db():
        pass

    async def mock_create_item(image_path: str, user_id: str = "legacy") -> dict:
        import uuid
        from datetime import datetime, timezone

        user_id = user_id if isinstance(user_id, str) else "legacy"
        now = datetime.now(timezone.utc).isoformat()
        item_id = str(uuid.uuid4())
        item = {
            "id": item_id,
            "user_id": user_id,
            "image_path": image_path,
            "image_paths_json": json.dumps([image_path]),
            "image_storage_state": "permanent",
            "status": "uploaded",
            "deleted_at": None,
            "purge_at": None,
            "notion_sync_status": "not_synced",
            "notion_sync_reason": None,
            "notion_page_id": None,
            "notion_page_url": None,
            "notion_last_attempt_at": None,
            "notion_last_success_at": None,
            "notion_last_error": None,
            "notion_sync_lease_token": None,
            "notion_sync_lease_expires_at": None,
            "notion_create_ambiguous": False,
            "analysis_json": None,
            "listing_json": None,
            "client_request_id": None,
            "upload_fingerprint": None,
            "upload_feedback_json": None,
            "pending_expires_at": None,
            "video_json": None,
            "notion_media_json": None,
            "created_at": now,
            "updated_at": now,
        }
        _mock_db[item_id] = item
        return item

    async def mock_claim_item_upload(user_id: str, client_request_id: str, upload_fingerprint: str):
        from datetime import datetime, timedelta, timezone

        for item in _mock_db.values():
            if item["user_id"] == user_id and item.get("client_request_id") == client_request_id:
                return dict(item), False
        item = await mock_create_item("", user_id)
        item.update({
            "image_storage_state": "pending",
            "status": "uploading",
            "client_request_id": client_request_id,
            "upload_fingerprint": upload_fingerprint,
            "pending_expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        })
        return dict(item), True

    async def mock_complete_item_upload(
        item_id: str,
        user_id: str,
        image_paths: list[str],
        feedback: list[dict],
    ) -> None:
        item = _mock_db.get(item_id)
        if not item or item.get("user_id") != user_id:
            raise LookupError("Item not found for this user")
        item["image_path"] = image_paths[0] if image_paths else ""
        item["image_paths_json"] = json.dumps(image_paths)
        item["upload_feedback_json"] = json.dumps(feedback)
        item["status"] = "uploaded"

    async def mock_get_item(item_id: str, user_id: str = "legacy") -> dict | None:
        user_id = user_id if isinstance(user_id, str) else "legacy"
        item = _mock_db.get(item_id)
        return dict(item) if item and item.get("user_id") == user_id else None

    async def mock_update_item_images(
        item_id: str,
        user_id: str = "legacy",
        image_paths: list[str] = None,
        image_storage_state: str | None = None,
    ) -> None:
        item = _mock_db.get(item_id)
        if not item:
            raise LookupError("Item not found for this user")
        item["image_path"] = image_paths[0] if image_paths else ""
        item["image_paths_json"] = json.dumps(image_paths)
        if image_storage_state:
            item["image_storage_state"] = image_storage_state

    async def mock_update_item_video(item_id: str, user_id: str = "legacy", video: dict | None = None) -> None:
        item = _mock_db.get(item_id)
        if not item or item.get("user_id") != user_id:
            raise LookupError("Item not found for this user")
        item["video_json"] = json.dumps(video) if video else None

    async def mock_delete_item(item_id: str, user_id: str = "legacy") -> None:
        if item_id in _mock_db:
            del _mock_db[item_id]
        _analysis_jobs.pop(item_id, None)

    async def mock_update_item_analysis(item_id: str, analysis: dict, listing: dict, status: str = "analyzed", *, user_id: str = "legacy") -> None:
        if item_id in _mock_db and _mock_db[item_id].get("user_id") == user_id:
            _mock_db[item_id]["analysis_json"] = json.dumps(analysis)
            _mock_db[item_id]["listing_json"] = json.dumps(listing)
            _mock_db[item_id]["status"] = status
        else:
            raise LookupError("Item not found for this user")

    async def mock_get_analysis_job(item_id: str, user_id: str = "legacy") -> dict | None:
        job = _analysis_jobs.get(item_id)
        return dict(job) if job and job["user_id"] == user_id else None

    async def mock_ensure_succeeded_analysis_job(item_id: str, user_id: str):
        item = _mock_db.get(item_id)
        if not item or item.get("user_id") != user_id or not item.get("analysis_json") or not item.get("listing_json"):
            raise LookupError("Completed analysis not found for this user")
        job = _analysis_jobs.setdefault(item_id, {
            "item_id": item_id,
            "user_id": user_id,
            "attempt_count": 0,
        })
        if job.get("user_id") != user_id:
            raise LookupError("Completed analysis not found for this user")
        job.update({
            "status": "succeeded",
            "lease_token": None,
            "lease_expires_at": None,
            "last_error_code": None,
        })
        return dict(job)

    async def mock_claim_analysis_job(
        item_id: str,
        user_id: str,
        *,
        lease_seconds: int,
        max_attempts: int,
    ):
        import uuid
        from datetime import datetime, timedelta, timezone

        item = _mock_db.get(item_id)
        if not item or item.get("user_id") != user_id:
            raise LookupError("Item not found for this user")
        now = datetime.now(timezone.utc)
        job = _analysis_jobs.setdefault(item_id, {
            "item_id": item_id,
            "user_id": user_id,
            "status": "queued",
            "attempt_count": 0,
            "lease_token": None,
            "lease_expires_at": None,
            "last_error_code": None,
        })
        lease_expired = job.get("lease_expires_at") and job["lease_expires_at"] <= now
        if (
            job["attempt_count"] < max_attempts
            and (job["status"] in {"queued", "retryable_failed"} or (job["status"] == "processing" and lease_expired))
        ):
            token = str(uuid.uuid4())
            job.update({
                "status": "processing",
                "attempt_count": job["attempt_count"] + 1,
                "lease_token": token,
                "lease_expires_at": now + timedelta(seconds=lease_seconds),
                "last_error_code": None,
            })
            return dict(job), token
        if job["status"] == "processing" and lease_expired and job["attempt_count"] >= max_attempts:
            job.update({
                "status": "terminal_failed",
                "lease_token": None,
                "lease_expires_at": None,
                "last_error_code": job.get("last_error_code") or "attempts_exhausted",
            })
        return dict(job), None

    async def mock_complete_analysis_job(item_id, user_id, lease_token, analysis, listing):
        job = _analysis_jobs.get(item_id)
        if not job or job.get("lease_token") != lease_token or job.get("user_id") != user_id:
            raise RuntimeError("Analysis lease is no longer current")
        await mock_update_item_analysis(item_id, analysis, listing, user_id=user_id)
        job.update({
            "status": "succeeded",
            "lease_token": None,
            "lease_expires_at": None,
            "last_error_code": None,
        })
        return dict(job)

    async def mock_fail_analysis_job(
        item_id,
        user_id,
        lease_token,
        *,
        error_code,
        retryable,
        consume_attempt,
        max_attempts,
    ):
        job = _analysis_jobs.get(item_id)
        if not job or job.get("lease_token") != lease_token or job.get("user_id") != user_id:
            raise RuntimeError("Analysis lease is no longer current")
        attempt_count = job["attempt_count"] if consume_attempt else max(job["attempt_count"] - 1, 0)
        job.update({
            "status": "retryable_failed" if retryable and (not consume_attempt or job["attempt_count"] < max_attempts) else "terminal_failed",
            "attempt_count": attempt_count,
            "lease_token": None,
            "lease_expires_at": None,
            "last_error_code": error_code,
        })
        return dict(job)

    async def mock_list_active_pending_paths():
        return []

    async def mock_list_expired_pending_items(user_id: str | None = None):
        return []

    async def mock_update_item_notion_sync(
        item_id: str,
        user_id: str = "legacy",
        *,
        sync_status: str,
        reason: str | None = None,
        page_id: str | None = None,
        page_url: str | None = None,
        last_error: str | None = None,
        attempted: bool = False,
        succeeded: bool = False,
    ) -> None:
        item = _mock_db.get(item_id)
        if item and item.get("user_id") == user_id:
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc).isoformat()
            item["notion_sync_status"] = sync_status
            item["notion_sync_reason"] = reason
            if attempted:
                item["notion_last_attempt_at"] = now
            if succeeded:
                item["notion_last_success_at"] = now
            if page_id:
                item["notion_page_id"] = page_id
            if page_url:
                item["notion_page_url"] = page_url
            item["notion_last_error"] = last_error

    async def mock_claim_item_notion_sync(
        item_id: str,
        user_id: str = "legacy",
        *,
        lease_seconds: int,
    ):
        import uuid
        from datetime import datetime, timedelta, timezone

        item = _mock_db.get(item_id)
        if not item or item.get("user_id") != user_id:
            raise LookupError("Item not found for this user")
        now = datetime.now(timezone.utc)
        lease_expires_at = item.get("notion_sync_lease_expires_at")
        if item.get("notion_sync_lease_token") and lease_expires_at and lease_expires_at > now:
            return dict(item), None
        lease_token = str(uuid.uuid4())
        item.update({
            "notion_sync_status": "syncing",
            "notion_sync_reason": None,
            "notion_sync_lease_token": lease_token,
            "notion_sync_lease_expires_at": now + timedelta(seconds=lease_seconds),
            "notion_last_attempt_at": now.isoformat(),
            "notion_last_error": None,
        })
        return dict(item), lease_token

    async def mock_finish_item_notion_sync(
        item_id: str,
        user_id: str,
        lease_token: str,
        *,
        sync_status: str,
        reason: str | None = None,
        page_id: str | None = None,
        page_url: str | None = None,
        last_error: str | None = None,
        succeeded: bool = False,
        create_ambiguous: bool = False,
        media: dict | None = None,
    ) -> dict:
        item = _mock_db.get(item_id)
        if (
            not item
            or item.get("user_id") != user_id
            or item.get("notion_sync_lease_token") != lease_token
        ):
            raise RuntimeError("Notion sync lease is no longer current")
        await mock_update_item_notion_sync(
            item_id,
            user_id,
            sync_status=sync_status,
            reason=reason,
            page_id=page_id,
            page_url=page_url,
            last_error=last_error,
            succeeded=succeeded,
        )
        item["notion_create_ambiguous"] = create_ambiguous
        if media is not None:
            item["notion_media_json"] = json.dumps(media)
        item["notion_sync_lease_token"] = None
        item["notion_sync_lease_expires_at"] = None
        return dict(item)

    async def mock_list_items(user_id: str = "legacy") -> list[dict]:
        return list(_mock_db.values())

    async def mock_trash_item(item_id: str, user_id: str = "legacy", purge_at: str = "") -> None:
        item = _mock_db.get(item_id)
        if not item:
            raise LookupError("Item not found for this user")
        from datetime import datetime, timezone
        item["status"] = "trashed"
        item["deleted_at"] = datetime.now(timezone.utc).isoformat()
        item["purge_at"] = purge_at

    async def mock_restore_item(item_id: str, user_id: str = "legacy") -> None:
        item = _mock_db.get(item_id)
        if not item:
            raise LookupError("Item not found for this user")
        item["status"] = "saved"
        item["deleted_at"] = None
        item["purge_at"] = None

    async def mock_list_expired_trashed_items(user_id: str | None = None) -> list[dict]:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        return [
            item for item in _mock_db.values()
            if item.get("status") == "trashed"
            and item.get("purge_at")
            and datetime.fromisoformat(item["purge_at"]) <= now
            and (user_id is None or item.get("user_id") == user_id)
        ]

    monkeypatch.setattr(database, "init_db", AsyncMock(side_effect=mock_init_db))
    monkeypatch.setattr(database, "close_db", AsyncMock(side_effect=mock_close_db))

    from app import main
    monkeypatch.setattr(main, "init_db", AsyncMock(side_effect=mock_init_db))
    monkeypatch.setattr(database, "create_item", AsyncMock(side_effect=mock_create_item))
    monkeypatch.setattr(database, "claim_item_upload", AsyncMock(side_effect=mock_claim_item_upload))
    monkeypatch.setattr(database, "complete_item_upload", AsyncMock(side_effect=mock_complete_item_upload))
    monkeypatch.setattr(database, "get_item", AsyncMock(side_effect=mock_get_item))
    monkeypatch.setattr(database, "update_item_images", AsyncMock(side_effect=mock_update_item_images))
    monkeypatch.setattr(database, "delete_item", AsyncMock(side_effect=mock_delete_item))
    monkeypatch.setattr(database, "update_item_video", AsyncMock(side_effect=mock_update_item_video))
    monkeypatch.setattr(database, "update_item_analysis", AsyncMock(side_effect=mock_update_item_analysis))
    monkeypatch.setattr(database, "get_analysis_job", AsyncMock(side_effect=mock_get_analysis_job))
    monkeypatch.setattr(database, "ensure_succeeded_analysis_job", AsyncMock(side_effect=mock_ensure_succeeded_analysis_job))
    monkeypatch.setattr(database, "claim_analysis_job", AsyncMock(side_effect=mock_claim_analysis_job))
    monkeypatch.setattr(database, "complete_analysis_job", AsyncMock(side_effect=mock_complete_analysis_job))
    monkeypatch.setattr(database, "fail_analysis_job", AsyncMock(side_effect=mock_fail_analysis_job))
    monkeypatch.setattr(database, "list_active_pending_paths", AsyncMock(side_effect=mock_list_active_pending_paths))
    monkeypatch.setattr(database, "list_expired_pending_items", AsyncMock(side_effect=mock_list_expired_pending_items))
    monkeypatch.setattr(database, "update_item_notion_sync", AsyncMock(side_effect=mock_update_item_notion_sync))
    monkeypatch.setattr(database, "claim_item_notion_sync", AsyncMock(side_effect=mock_claim_item_notion_sync))
    monkeypatch.setattr(database, "finish_item_notion_sync", AsyncMock(side_effect=mock_finish_item_notion_sync))
    monkeypatch.setattr(database, "list_items", AsyncMock(side_effect=mock_list_items))
    monkeypatch.setattr(database, "trash_item", AsyncMock(side_effect=mock_trash_item))
    monkeypatch.setattr(database, "restore_item", AsyncMock(side_effect=mock_restore_item))
    monkeypatch.setattr(database, "list_expired_trashed_items", AsyncMock(side_effect=mock_list_expired_trashed_items))

    from app.api import items as items_api
    monkeypatch.setattr(items_api, "create_item", AsyncMock(side_effect=mock_create_item))
    monkeypatch.setattr(items_api, "claim_item_upload", AsyncMock(side_effect=mock_claim_item_upload))
    monkeypatch.setattr(items_api, "complete_item_upload", AsyncMock(side_effect=mock_complete_item_upload))
    monkeypatch.setattr(items_api, "delete_item", AsyncMock(side_effect=mock_delete_item))
    monkeypatch.setattr(items_api, "get_item", AsyncMock(side_effect=mock_get_item))
    monkeypatch.setattr(items_api, "update_item_analysis", AsyncMock(side_effect=mock_update_item_analysis))
    monkeypatch.setattr(items_api, "get_analysis_job", AsyncMock(side_effect=mock_get_analysis_job))
    monkeypatch.setattr(items_api, "ensure_succeeded_analysis_job", AsyncMock(side_effect=mock_ensure_succeeded_analysis_job))
    monkeypatch.setattr(items_api, "claim_analysis_job", AsyncMock(side_effect=mock_claim_analysis_job))
    monkeypatch.setattr(items_api, "complete_analysis_job", AsyncMock(side_effect=mock_complete_analysis_job))
    monkeypatch.setattr(items_api, "fail_analysis_job", AsyncMock(side_effect=mock_fail_analysis_job))
    monkeypatch.setattr(items_api, "update_item_images", AsyncMock(side_effect=mock_update_item_images))
    monkeypatch.setattr(items_api, "update_item_video", AsyncMock(side_effect=mock_update_item_video))
    monkeypatch.setattr(items_api, "update_item_notion_sync", AsyncMock(side_effect=mock_update_item_notion_sync))
    monkeypatch.setattr(items_api, "claim_item_notion_sync", AsyncMock(side_effect=mock_claim_item_notion_sync))
    monkeypatch.setattr(items_api, "finish_item_notion_sync", AsyncMock(side_effect=mock_finish_item_notion_sync))
    monkeypatch.setattr(items_api, "trash_item", AsyncMock(side_effect=mock_trash_item))
    monkeypatch.setattr(items_api, "restore_item", AsyncMock(side_effect=mock_restore_item))
    monkeypatch.setattr(items_api, "list_expired_trashed_items", AsyncMock(side_effect=mock_list_expired_trashed_items))
    monkeypatch.setattr(items_api, "list_expired_pending_items", AsyncMock(side_effect=mock_list_expired_pending_items))
    monkeypatch.setattr(main, "list_active_pending_paths", AsyncMock(side_effect=mock_list_active_pending_paths))
    monkeypatch.setattr(main, "list_expired_pending_items", AsyncMock(side_effect=mock_list_expired_pending_items))

    from app.services.storage import InMemoryStorage
    monkeypatch.setattr(items_api, "storage_service", InMemoryStorage())

    # Also mock UPLOAD_DIR for tests that still try to use it or need a temp dir
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    return upload_dir
