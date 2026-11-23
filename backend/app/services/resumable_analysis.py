"""Durable analysis state with request-inline execution.

The web request is the executor today. PostgreSQL state and leases make retries
idempotent and allow a future background worker to reuse the same contract.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from app.config import settings
from app.schemas.listing import AnalysisJobStatus
from app.services.analyze_service import analyze_item_record
from app.services.storage import Storage, storage_service

logger = logging.getLogger("uvicorn.error")

ClaimJob = Callable[..., Awaitable[tuple[dict[str, Any], str | None]]]
CompleteJob = Callable[..., Awaitable[dict[str, Any]]]
FailJob = Callable[..., Awaitable[dict[str, Any]]]


def _as_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def analysis_job_status(record: dict[str, Any]) -> AnalysisJobStatus:
    lease_expires_at = _as_datetime(record.get("lease_expires_at"))
    lease_expired = bool(
        lease_expires_at
        and lease_expires_at <= datetime.now(timezone.utc)
    )
    status = str(record.get("status") or "queued")
    attempt_count = int(record.get("attempt_count") or 0)
    last_error_code = record.get("last_error_code")
    if status == "processing" and lease_expired and attempt_count >= settings.analysis_max_attempts:
        status = "terminal_failed"
        last_error_code = last_error_code or "attempts_exhausted"
    return AnalysisJobStatus(
        item_id=str(record["item_id"]),
        status=status,
        attempt_count=attempt_count,
        can_retry=(
            status in {"queued", "retryable_failed"}
            or (status == "processing" and lease_expired)
        )
        and attempt_count < settings.analysis_max_attempts,
        last_error_code=last_error_code,
        lease_expires_at=lease_expires_at,
    )


def _safe_failure(exc: HTTPException) -> tuple[str, bool, bool]:
    if isinstance(exc.detail, dict):
        code = exc.detail.get("code")
        if code in {"AI_CREDENTIAL_REQUIRED", "AI_PROVIDER_CREDENTIAL_INVALID"}:
            return code, True, False
    if exc.status_code == 404:
        return "image_missing", False, True
    if exc.status_code in {429, 502, 503, 504}:
        return "analysis_temporarily_unavailable", True, True
    return "analysis_failed", False, True


async def execute_resumable_analysis(
    item: dict[str, Any],
    *,
    claim_job: ClaimJob,
    complete_job: CompleteJob,
    fail_job: FailJob,
    ai: Any,
    storage: Storage = storage_service,
) -> AnalysisJobStatus:
    item_id = str(item["id"])
    user_id = str(item["user_id"])
    record, lease_token = await claim_job(
        item_id,
        user_id,
        lease_seconds=settings.analysis_lease_seconds,
        max_attempts=settings.analysis_max_attempts,
    )
    if lease_token is None:
        return analysis_job_status(record)

    async def defer_persistence(*_args: Any, **_kwargs: Any) -> None:
        return None

    try:
        result = await analyze_item_record(
            item,
            ai=ai,
            update_analysis=defer_persistence,
            storage=storage,
        )
        record = await complete_job(
            item_id,
            user_id,
            lease_token,
            result.analysis.model_dump(),
            result.listing.model_dump(),
        )
    except HTTPException as exc:
        error_code, retryable, consume_attempt = _safe_failure(exc)
        record = await fail_job(
            item_id,
            user_id,
            lease_token,
            error_code=error_code,
            retryable=retryable,
            consume_attempt=consume_attempt,
            max_attempts=settings.analysis_max_attempts,
        )
        logger.warning(
            "Inline analysis failed item_id=%s status=%s error_code=%s",
            item_id,
            record.get("status"),
            error_code,
        )
    except Exception:
        await fail_job(
            item_id,
            user_id,
            lease_token,
            error_code="internal_error",
            retryable=False,
            consume_attempt=True,
            max_attempts=settings.analysis_max_attempts,
        )
        logger.exception("Inline analysis crashed item_id=%s", item_id)
        raise
    return analysis_job_status(record)
