import json
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg

from app.config import settings
from app.db.migrations import run_migrations

# Global connection pool
pool: asyncpg.Pool | None = None


async def init_db() -> None:
    global pool
    # Initialize connection pool with statement_cache_size=0 for PgBouncer/transaction pooler compatibility
    pool = await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=1,
        max_size=10,
        statement_cache_size=0,
    )
    
    async with pool.acquire() as conn:
        await run_migrations(conn)


async def close_db() -> None:
    global pool
    if pool is not None:
        await pool.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def create_item(image_path: str, user_id: str) -> dict:
    item_id = str(uuid.uuid4())
    now = _now()
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            INSERT INTO items (
                id, user_id, image_path, image_paths_json, status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            item_id,
            user_id,
            image_path,
            json.dumps([image_path] if image_path else []),
            "uploaded",
            now,
            now,
        )
    return {"id": item_id, "image_path": image_path, "status": "uploaded", "created_at": now, "updated_at": now}


async def claim_item_upload(
    user_id: str,
    client_request_id: str,
    upload_fingerprint: str,
) -> tuple[dict, bool]:
    """Atomically map one user operation to one item record."""
    item_id = str(uuid.uuid4())
    now = _now()
    pending_expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.pending_item_retention_hours)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO items (
                id, user_id, image_path, image_paths_json, image_storage_state,
                status, client_request_id, upload_fingerprint,
                pending_expires_at, created_at, updated_at
            ) VALUES ($1, $2, '', '[]', 'pending', 'uploading', $3, $4, $5, $6, $6)
            ON CONFLICT (user_id, client_request_id)
            WHERE client_request_id IS NOT NULL
            DO NOTHING
            RETURNING *
            """,
            item_id,
            user_id,
            client_request_id,
            upload_fingerprint,
            pending_expires_at,
            now,
        )
        if row:
            return dict(row), True
        row = await conn.fetchrow(
            "SELECT * FROM items WHERE user_id = $1 AND client_request_id = $2",
            user_id,
            client_request_id,
        )
    if not row:
        raise RuntimeError("Could not resolve idempotent upload claim")
    return dict(row), False


async def complete_item_upload(
    item_id: str,
    user_id: str,
    image_paths: list[str],
    feedback: list[dict],
) -> None:
    now = _now()
    primary = image_paths[0] if image_paths else ""
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            UPDATE items
            SET image_path = $1,
                image_paths_json = $2,
                image_storage_state = 'pending',
                upload_feedback_json = $3,
                status = 'uploaded',
                updated_at = $4
            WHERE id = $5 AND user_id = $6
            """,
            primary,
            json.dumps(image_paths),
            json.dumps(feedback),
            now,
            item_id,
            user_id,
        )
    if result != "UPDATE 1":
        raise LookupError("Item not found for this user")


async def update_item_images(
    item_id: str,
    user_id: str,
    image_paths: list[str],
    image_storage_state: str | None = None,
) -> None:
    now = _now()
    primary = image_paths[0] if image_paths else ""
    async with pool.acquire() as conn:
        pending_expires_at = (
            datetime.now(timezone.utc) + timedelta(hours=settings.pending_item_retention_hours)
            if image_storage_state == "pending"
            else None
        )
        result = await conn.execute(
            """
            UPDATE items 
            SET image_path = $1,
                image_paths_json = $2,
                image_storage_state = COALESCE($3, image_storage_state),
                pending_expires_at = CASE
                    WHEN $3 = 'pending' THEN COALESCE(pending_expires_at, $4)
                    WHEN $3 = 'permanent' THEN NULL
                    ELSE pending_expires_at
                END,
                updated_at = $5
            WHERE id = $6 AND user_id = $7
            """,
            primary,
            json.dumps(image_paths),
            image_storage_state,
            pending_expires_at,
            now,
            item_id,
            user_id,
        )
    if result != "UPDATE 1":
        raise LookupError("Item not found for this user")


async def delete_item(item_id: str, user_id: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM items WHERE id = $1 AND user_id = $2", item_id, user_id)


def item_image_paths(item: dict) -> list[str]:
    raw = item.get("image_paths_json")
    if raw:
        try:
            paths = json.loads(raw)
            if isinstance(paths, list):
                return [str(path) for path in paths if path]
        except json.JSONDecodeError:
            pass
    image_path = item.get("image_path")
    return [str(image_path)] if image_path else []


def item_video_record(item: dict) -> dict | None:
    """The listing's video metadata (path, frames, duration), or None when it has no video."""
    raw = item.get("video_json")
    if not raw:
        return None
    try:
        video = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        return None
    if not isinstance(video, dict) or not video.get("path"):
        return None
    return video


def item_video_paths(item: dict) -> list[str]:
    """Storage paths owned by the video: the file itself and its analysis frames."""
    video = item_video_record(item)
    if not video:
        return []
    paths = [str(video["path"])]
    for frame in video.get("frames") or []:
        if isinstance(frame, dict) and frame.get("path"):
            paths.append(str(frame["path"]))
    return list(dict.fromkeys(paths))


def item_media_paths(item: dict) -> list[str]:
    """Every stored object for an item (photos, video and frames), for deletion."""
    return list(dict.fromkeys([*item_image_paths(item), *item_video_paths(item)]))


def item_notion_media(item: dict) -> dict:
    raw = item.get("notion_media_json")
    if not raw:
        return {}
    try:
        media = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        return {}
    return media if isinstance(media, dict) else {}


async def update_item_video(item_id: str, user_id: str, video: dict | None) -> None:
    """Set or clear the listing's single video."""
    now = _now()
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            UPDATE items
            SET video_json = $1, updated_at = $2
            WHERE id = $3 AND user_id = $4
            """,
            json.dumps(video) if video else None,
            now,
            item_id,
            user_id,
        )
    if result != "UPDATE 1":
        raise LookupError("Item not found for this user")


async def get_item(item_id: str, user_id: str) -> dict | None:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM items WHERE id = $1 AND user_id = $2", item_id, user_id
        )
        if not row:
            return None
        return dict(row)


async def get_analysis_job(item_id: str, user_id: str) -> dict | None:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM analysis_jobs WHERE item_id = $1 AND user_id = $2",
            item_id,
            user_id,
        )
    return dict(row) if row else None


async def ensure_succeeded_analysis_job(item_id: str, user_id: str) -> dict:
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO analysis_jobs (
                item_id, user_id, status, completed_at, updated_at
            )
            SELECT id, user_id, 'succeeded', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM items
            WHERE id = $1 AND user_id = $2
              AND analysis_json IS NOT NULL AND listing_json IS NOT NULL
            ON CONFLICT (item_id) DO UPDATE
            SET status = 'succeeded',
                lease_token = NULL,
                lease_expires_at = NULL,
                last_error_code = NULL,
                completed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE analysis_jobs.user_id = EXCLUDED.user_id
            """,
            item_id,
            user_id,
        )
        row = await conn.fetchrow(
            "SELECT * FROM analysis_jobs WHERE item_id = $1 AND user_id = $2",
            item_id,
            user_id,
        )
    if not row:
        raise LookupError("Completed analysis not found for this user")
    return dict(row)


async def claim_analysis_job(
    item_id: str,
    user_id: str,
    *,
    lease_seconds: int,
    max_attempts: int,
) -> tuple[dict, str | None]:
    """Claim queued, retryable, or expired work and return its lease token."""
    lease_token = str(uuid.uuid4())
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO analysis_jobs (item_id, user_id)
                SELECT id, user_id FROM items WHERE id = $1 AND user_id = $2
                ON CONFLICT (item_id) DO NOTHING
                """,
                item_id,
                user_id,
            )
            row = await conn.fetchrow(
                """
                UPDATE analysis_jobs
                SET status = 'processing',
                    attempt_count = attempt_count + 1,
                    lease_token = $3,
                    lease_expires_at = CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second'),
                    last_error_code = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE item_id = $1
                  AND user_id = $2
                  AND attempt_count < $5
                  AND (
                      status IN ('queued', 'retryable_failed')
                      OR (status = 'processing' AND lease_expires_at <= CURRENT_TIMESTAMP)
                  )
                RETURNING *
                """,
                item_id,
                user_id,
                lease_token,
                lease_seconds,
                max_attempts,
            )
            if row:
                return dict(row), lease_token
            await conn.execute(
                """
                UPDATE analysis_jobs
                SET status = 'terminal_failed',
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    last_error_code = COALESCE(last_error_code, 'attempts_exhausted'),
                    updated_at = CURRENT_TIMESTAMP
                WHERE item_id = $1 AND user_id = $2
                  AND status = 'processing'
                  AND lease_expires_at <= CURRENT_TIMESTAMP
                  AND attempt_count >= $3
                """,
                item_id,
                user_id,
                max_attempts,
            )
            row = await conn.fetchrow(
                "SELECT * FROM analysis_jobs WHERE item_id = $1 AND user_id = $2",
                item_id,
                user_id,
            )
    if not row:
        raise LookupError("Item not found for this user")
    return dict(row), None


async def complete_analysis_job(
    item_id: str,
    user_id: str,
    lease_token: str,
    analysis: dict,
    listing: dict,
) -> dict:
    now = _now()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE analysis_jobs
                SET status = 'succeeded',
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    last_error_code = NULL,
                    completed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE item_id = $1 AND user_id = $2
                  AND status = 'processing' AND lease_token = $3
                RETURNING *
                """,
                item_id,
                user_id,
                lease_token,
            )
            if not row:
                raise RuntimeError("Analysis lease is no longer current")
            result = await conn.execute(
                """
                UPDATE items
                SET analysis_json = $1, listing_json = $2, status = 'analyzed', updated_at = $3
                WHERE id = $4 AND user_id = $5
                """,
                json.dumps(analysis),
                json.dumps(listing),
                now,
                item_id,
                user_id,
            )
            if result != "UPDATE 1":
                raise LookupError("Item not found for this user")
    return dict(row)


async def fail_analysis_job(
    item_id: str,
    user_id: str,
    lease_token: str,
    *,
    error_code: str,
    retryable: bool,
    consume_attempt: bool,
    max_attempts: int,
) -> dict:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE analysis_jobs
            SET status = CASE
                    WHEN $5 AND (NOT $6 OR attempt_count < $7) THEN 'retryable_failed'
                    ELSE 'terminal_failed'
                END,
                attempt_count = CASE
                    WHEN $6 THEN attempt_count
                    ELSE GREATEST(attempt_count - 1, 0)
                END,
                lease_token = NULL,
                lease_expires_at = NULL,
                last_error_code = $4,
                updated_at = CURRENT_TIMESTAMP
            WHERE item_id = $1 AND user_id = $2
              AND status = 'processing' AND lease_token = $3
            RETURNING *
            """,
            item_id,
            user_id,
            lease_token,
            error_code,
            retryable,
            consume_attempt,
            max_attempts,
        )
    if not row:
        raise RuntimeError("Analysis lease is no longer current")
    return dict(row)


async def list_active_pending_paths() -> list[str]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT image_path, image_paths_json FROM items
            WHERE image_storage_state = 'pending'
              AND (pending_expires_at IS NULL OR pending_expires_at > CURRENT_TIMESTAMP)
            """
        )
    paths: list[str] = []
    for row in rows:
        paths.extend(item_image_paths(dict(row)))
    return list(dict.fromkeys(paths))


async def list_expired_pending_items(user_id: str | None = None) -> list[dict]:
    async with pool.acquire() as conn:
        if user_id:
            rows = await conn.fetch(
                """
                SELECT * FROM items
                WHERE user_id = $1
                  AND image_storage_state = 'pending'
                  AND pending_expires_at IS NOT NULL
                  AND pending_expires_at <= CURRENT_TIMESTAMP
                """,
                user_id,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT * FROM items
                WHERE image_storage_state = 'pending'
                  AND pending_expires_at IS NOT NULL
                  AND pending_expires_at <= CURRENT_TIMESTAMP
                """
            )
    return [dict(row) for row in rows]


async def update_item_analysis(
    item_id: str,
    analysis: dict,
    listing: dict,
    status: str = "analyzed",
    *,
    user_id: str,
) -> None:
    now = _now()
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            UPDATE items 
            SET analysis_json = $1, listing_json = $2, status = $3, updated_at = $4
            WHERE id = $5 AND user_id = $6
            """,
            json.dumps(analysis),
            json.dumps(listing),
            status,
            now,
            item_id,
            user_id,
        )
    if result != "UPDATE 1":
        raise LookupError("Item not found for this user")


async def update_item_notion_sync(
    item_id: str,
    user_id: str,
    *,
    sync_status: str,
    reason: str | None = None,
    page_id: str | None = None,
    page_url: str | None = None,
    last_error: str | None = None,
    attempted: bool = False,
    succeeded: bool = False,
) -> None:
    now = _now()
    last_attempt_at = now if attempted else None
    last_success_at = now if succeeded else None
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            UPDATE items SET
                notion_sync_status = $1,
                notion_sync_reason = $2,
                notion_page_id = COALESCE($3, notion_page_id),
                notion_page_url = COALESCE($4, notion_page_url),
                notion_last_attempt_at = COALESCE($5, notion_last_attempt_at),
                notion_last_success_at = COALESCE($6, notion_last_success_at),
                notion_last_error = $7,
                updated_at = $8
            WHERE id = $9 AND user_id = $10
            """,
            sync_status,
            reason,
            page_id,
            page_url,
            last_attempt_at,
            last_success_at,
            last_error,
            now,
            item_id,
            user_id,
        )
    if result != "UPDATE 1":
        raise LookupError("Item not found for this user")


async def claim_item_notion_sync(
    item_id: str,
    user_id: str,
    *,
    lease_seconds: int,
) -> tuple[dict, str | None]:
    """Atomically claim an item-scoped Notion write with a bounded lease."""
    lease_token = str(uuid.uuid4())
    now = _now()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE items
            SET notion_sync_status = 'syncing',
                notion_sync_reason = NULL,
                notion_sync_lease_token = $3,
                notion_sync_lease_expires_at = CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second'),
                notion_last_attempt_at = $5,
                notion_last_error = NULL,
                updated_at = $5
            WHERE id = $1 AND user_id = $2
              AND (
                  notion_sync_lease_token IS NULL
                  OR notion_sync_lease_expires_at IS NULL
                  OR notion_sync_lease_expires_at <= CURRENT_TIMESTAMP
              )
            RETURNING *
            """,
            item_id,
            user_id,
            lease_token,
            lease_seconds,
            now,
        )
        if row:
            return dict(row), lease_token
        row = await conn.fetchrow(
            "SELECT * FROM items WHERE id = $1 AND user_id = $2",
            item_id,
            user_id,
        )
    if not row:
        raise LookupError("Item not found for this user")
    return dict(row), None


async def finish_item_notion_sync(
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
    """Persist a Notion result only when the caller still owns the write lease.

    ``media`` records what the sync did with the video (its reusable Notion upload and
    any warning for the app); ``None`` leaves the stored value unchanged.
    """
    now = _now()
    last_success_at = now if succeeded else None
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE items SET
                notion_sync_status = $4,
                notion_sync_reason = $5,
                notion_page_id = COALESCE($6, notion_page_id),
                notion_page_url = COALESCE($7, notion_page_url),
                notion_last_success_at = COALESCE($8, notion_last_success_at),
                notion_last_error = $9,
                notion_create_ambiguous = $10,
                notion_media_json = COALESCE($12, notion_media_json),
                notion_sync_lease_token = NULL,
                notion_sync_lease_expires_at = NULL,
                updated_at = $11
            WHERE id = $1 AND user_id = $2
              AND notion_sync_lease_token = $3
            RETURNING *
            """,
            item_id,
            user_id,
            lease_token,
            sync_status,
            reason,
            page_id,
            page_url,
            last_success_at,
            last_error,
            create_ambiguous,
            now,
            json.dumps(media) if media is not None else None,
        )
    if not row:
        raise RuntimeError("Notion sync lease is no longer current")
    return dict(row)


async def trash_item(item_id: str, user_id: str, purge_at: str) -> None:
    now = _now()
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            UPDATE items
            SET status = 'trashed', deleted_at = $1, purge_at = $2, updated_at = $1
            WHERE id = $3 AND user_id = $4 AND status != 'trashed'
            """,
            now,
            purge_at,
            item_id,
            user_id,
        )
    if result != "UPDATE 1":
        raise LookupError("Item not found or already trashed")


async def restore_item(item_id: str, user_id: str) -> None:
    now = _now()
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            UPDATE items
            SET status = 'saved', deleted_at = NULL, purge_at = NULL, updated_at = $1
            WHERE id = $2 AND user_id = $3 AND status = 'trashed'
            """,
            now,
            item_id,
            user_id,
        )
    if result != "UPDATE 1":
        raise LookupError("Trashed item not found")


async def list_expired_trashed_items(user_id: str | None = None) -> list[dict]:
    now = _now()
    async with pool.acquire() as conn:
        if user_id:
            rows = await conn.fetch(
                "SELECT * FROM items WHERE user_id = $1 AND status = 'trashed' AND purge_at <= $2",
                user_id,
                now,
            )
        else:
            rows = await conn.fetch(
                "SELECT * FROM items WHERE status = 'trashed' AND purge_at <= $1",
                now,
            )
        return [dict(row) for row in rows]


async def list_items(user_id: str) -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM items WHERE user_id = $1 ORDER BY created_at DESC", user_id
        )
        return [dict(row) for row in rows]


async def delete_items_for_user(user_id: str) -> None:
    """Delete every server-side listing owned by a Firebase UID."""
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM items WHERE user_id = $1", user_id)
