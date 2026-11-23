import io
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from PIL import Image
from starlette.datastructures import Headers, UploadFile
from unittest.mock import AsyncMock

from app.api import items as items_api
from app.config import settings
from app.models import database
from app.schemas.listing import AnalyzeRequest, AnalysisJobStatus, GeneratedListing, PriceSuggestion, VisionAnalysis
from app.services.ai_credentials import AIProviderCredentialInvalidError
from app.services.gemini_client import GeminiClientError
from app.services.resumable_analysis import _safe_failure, analysis_job_status


@pytest.mark.parametrize("code", ["AI_CREDENTIAL_REQUIRED", "AI_PROVIDER_CREDENTIAL_INVALID"])
def test_credential_failures_remain_retryable_after_settings_update(code):
    error = HTTPException(status_code=503, detail={"code": code, "message": "safe"})

    assert _safe_failure(error) == (code, True, False)


def _upload_file() -> UploadFile:
    image = Image.new("RGB", (800, 600), color=(80, 120, 160))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return UploadFile(
        file=io.BytesIO(buffer.getvalue()),
        filename="item.jpg",
        headers=Headers({"content-type": "image/jpeg"}),
    )


def test_processing_job_becomes_retryable_only_after_lease_expiry(monkeypatch):
    monkeypatch.setattr(settings, "analysis_max_attempts", 3)
    base = {
        "item_id": "item-1",
        "status": "processing",
        "attempt_count": 1,
        "last_error_code": None,
    }

    active = analysis_job_status({
        **base,
        "lease_expires_at": datetime.now(timezone.utc) + timedelta(minutes=1),
    })
    expired = analysis_job_status({
        **base,
        "lease_expires_at": datetime.now(timezone.utc) - timedelta(seconds=1),
    })

    assert active.can_retry is False
    assert expired.can_retry is True

    exhausted = analysis_job_status({
        **base,
        "attempt_count": 3,
        "lease_expires_at": datetime.now(timezone.utc) - timedelta(seconds=1),
    })
    assert exhausted.status == "terminal_failed"
    assert exhausted.can_retry is False
    assert exhausted.last_error_code == "attempts_exhausted"


class RecordingAI:
    def __init__(self) -> None:
        self.analysis_calls = 0
        self.listing_calls = 0

    async def analyze_image_bytes(self, _image_bytes):
        self.analysis_calls += 1
        return VisionAnalysis(
            item_name="Desk Lamp",
            category="Home",
            condition="Good",
            confidence=0.9,
        )

    async def generate_listing(self, _analysis):
        self.listing_calls += 1
        return GeneratedListing(
            title="Desk Lamp",
            description="Clean desk lamp.",
            marketplace_category="Home",
            price_suggestion=PriceSuggestion(recommended_price=15),
        )


def _use_route_ai(monkeypatch, ai, provider: str = "groq", source: str = "server_fallback") -> None:
    monkeypatch.setattr(
        items_api,
        "ensure_ai_provider_configured",
        lambda *_args: (ai, SimpleNamespace(provider=provider, source=source)),
    )


@pytest.mark.asyncio
async def test_inline_analysis_persists_result_and_reuses_completed_job(temp_db, monkeypatch):
    upload = await items_api.upload_images(
        [_upload_file()],
        uid="owner-a",
        idempotency_key="analysis-operation",
    )
    ai = RecordingAI()
    _use_route_ai(monkeypatch, ai)
    monkeypatch.setattr(settings, "ai_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "test-key")

    first_http = Response()
    first = await items_api.start_or_resume_analysis(upload.item_id, first_http, uid="owner-a")
    second_http = Response()
    second = await items_api.start_or_resume_analysis(upload.item_id, second_http, uid="owner-a")
    item = await items_api.get_item_by_id(upload.item_id, uid="owner-a")

    assert first.job.status == "succeeded"
    assert second.job.status == "succeeded"
    assert first.job.attempt_count == second.job.attempt_count == 1
    assert ai.analysis_calls == ai.listing_calls == 1
    assert item.analysis_job is not None
    assert item.analysis_job.status == "succeeded"
    assert item.listing is not None
    assert item.listing.title == "Desk Lamp"


@pytest.mark.asyncio
async def test_resumable_endpoint_reuses_legacy_synchronous_result(temp_db, monkeypatch):
    upload = await items_api.upload_images(
        [_upload_file()],
        uid="owner-a",
        idempotency_key="legacy-result-operation",
    )
    await database.update_item_analysis(
        upload.item_id,
        VisionAnalysis(item_name="Existing Lamp").model_dump(),
        GeneratedListing(title="Existing Lamp").model_dump(),
        user_id="owner-a",
    )
    ai = RecordingAI()
    _use_route_ai(monkeypatch, ai)
    monkeypatch.setattr(settings, "ai_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "test-key")

    response = await items_api.start_or_resume_analysis(upload.item_id, Response(), uid="owner-a")

    assert response.job.status == "succeeded"
    assert response.job.attempt_count == 0
    assert ai.analysis_calls == ai.listing_calls == 0


@pytest.mark.asyncio
async def test_legacy_analysis_reconciles_existing_terminal_job(temp_db, monkeypatch):
    upload = await items_api.upload_images(
        [_upload_file()],
        uid="owner-a",
        idempotency_key="legacy-reconciliation-operation",
    )
    failing = RecordingAI()

    async def fail(_image_bytes):
        raise GeminiClientError("provider detail")

    failing.analyze_image_bytes = fail
    _use_route_ai(monkeypatch, failing)
    monkeypatch.setattr(settings, "ai_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "test-key")

    for _ in range(settings.analysis_max_attempts):
        failed = await items_api.start_or_resume_analysis(upload.item_id, Response(), uid="owner-a")
    assert failed.job.status == "terminal_failed"

    legacy_ai = RecordingAI()
    _use_route_ai(monkeypatch, legacy_ai)
    await items_api.analyze_item(AnalyzeRequest(item_id=upload.item_id), uid="owner-a")

    reconciled = await items_api.start_or_resume_analysis(upload.item_id, Response(), uid="owner-a")

    assert reconciled.job.status == "succeeded"
    assert reconciled.job.attempt_count == settings.analysis_max_attempts
    assert reconciled.job.last_error_code is None
    assert legacy_ai.analysis_calls == legacy_ai.listing_calls == 1


@pytest.mark.asyncio
async def test_retryable_inline_failure_reuses_item_and_attempt_count(temp_db, monkeypatch):
    upload = await items_api.upload_images(
        [_upload_file()],
        uid="owner-a",
        idempotency_key="retry-operation",
    )
    failing = RecordingAI()

    async def fail(_image_bytes):
        raise GeminiClientError("provider detail")

    failing.analyze_image_bytes = fail
    _use_route_ai(monkeypatch, failing)
    monkeypatch.setattr(settings, "ai_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "test-key")

    failed = await items_api.start_or_resume_analysis(upload.item_id, Response(), uid="owner-a")
    assert failed.job.status == "retryable_failed"
    assert failed.job.can_retry is True
    assert failed.job.last_error_code == "analysis_temporarily_unavailable"

    recovered_ai = RecordingAI()
    _use_route_ai(monkeypatch, recovered_ai)
    recovered = await items_api.start_or_resume_analysis(upload.item_id, Response(), uid="owner-a")

    assert recovered.job.status == "succeeded"
    assert recovered.job.attempt_count == 2
    assert (await database.get_item(upload.item_id, "owner-a"))["status"] == "analyzed"


@pytest.mark.asyncio
async def test_invalid_credentials_do_not_exhaust_resumable_job(temp_db, monkeypatch):
    upload = await items_api.upload_images(
        [_upload_file()],
        uid="owner-a",
        idempotency_key="credential-recovery-operation",
    )

    class InvalidCredentialAI:
        async def analyze_image_bytes(self, _image_bytes):
            raise AIProviderCredentialInvalidError

    _use_route_ai(monkeypatch, InvalidCredentialAI(), source="byok")

    for _ in range(settings.analysis_max_attempts + 1):
        failed = await items_api.start_or_resume_analysis(
            upload.item_id,
            Response(),
            uid="owner-a",
        )
        assert failed.job.status == "retryable_failed"
        assert failed.job.can_retry is True
        assert failed.job.attempt_count == 0
        assert failed.job.last_error_code == "AI_PROVIDER_CREDENTIAL_INVALID"

    recovered_ai = RecordingAI()
    _use_route_ai(monkeypatch, recovered_ai, source="byok")
    recovered = await items_api.start_or_resume_analysis(
        upload.item_id,
        Response(),
        uid="owner-a",
    )

    assert recovered.job.status == "succeeded"
    assert recovered.job.attempt_count == 1
    assert recovered_ai.analysis_calls == recovered_ai.listing_calls == 1


@pytest.mark.asyncio
async def test_resumable_analysis_is_owner_scoped(temp_db, monkeypatch):
    upload = await items_api.upload_images(
        [_upload_file()],
        uid="owner-a",
        idempotency_key="owner-operation",
    )
    monkeypatch.setattr(settings, "ai_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "test-key")

    with pytest.raises(items_api.HTTPException) as raised:
        await items_api.start_or_resume_analysis(upload.item_id, Response(), uid="owner-b")

    assert raised.value.status_code == 404


@pytest.mark.asyncio
async def test_analysis_job_status_is_owner_scoped_and_skips_item_response(temp_db, monkeypatch):
    upload = await items_api.upload_images(
        [_upload_file()],
        uid="owner-a",
        idempotency_key="status-operation",
    )
    await items_api.claim_analysis_job(
        upload.item_id,
        "owner-a",
        lease_seconds=60,
        max_attempts=3,
    )
    build_item_response = AsyncMock(side_effect=AssertionError("full item response must not be built"))
    monkeypatch.setattr(items_api, "item_response_from_record", build_item_response)

    response = await items_api.get_analysis_job_status(upload.item_id, uid="owner-a")

    assert response.job.status == "processing"
    assert response.job.attempt_count == 1
    build_item_response.assert_not_awaited()

    with pytest.raises(items_api.HTTPException) as raised:
        await items_api.get_analysis_job_status(upload.item_id, uid="owner-b")
    assert raised.value.status_code == 404


@pytest.mark.asyncio
async def test_analysis_job_status_returns_not_found_before_kickoff(temp_db):
    upload = await items_api.upload_images(
        [_upload_file()],
        uid="owner-a",
        idempotency_key="missing-status-operation",
    )

    with pytest.raises(items_api.HTTPException) as raised:
        await items_api.get_analysis_job_status(upload.item_id, uid="owner-a")

    assert raised.value.status_code == 404


@pytest.mark.asyncio
async def test_duplicate_active_kickoff_returns_processing_without_new_work(temp_db, monkeypatch):
    upload = await items_api.upload_images(
        [_upload_file()],
        uid="owner-a",
        idempotency_key="active-operation",
    )
    active = AnalysisJobStatus(
        item_id=upload.item_id,
        status="processing",
        attempt_count=1,
        can_retry=False,
    )
    execute = AsyncMock(return_value=active)
    monkeypatch.setattr(items_api, "execute_resumable_analysis", execute)
    monkeypatch.setattr(settings, "ai_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "test-key")
    http_response = Response()

    response = await items_api.start_or_resume_analysis(upload.item_id, http_response, uid="owner-a")

    assert http_response.status_code == 202
    assert response.job.status == "processing"
    execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_discard_pending_item_removes_job_record_and_images(temp_db, monkeypatch):
    upload = await items_api.upload_images(
        [_upload_file()],
        uid="owner-a",
        idempotency_key="discard-operation",
    )
    item = await database.get_item(upload.item_id, "owner-a")
    assert item is not None
    paths = database.item_image_paths(item)

    result = await items_api.discard_item_draft(upload.item_id, uid="owner-a")

    assert result == {"item_id": upload.item_id, "discarded": True}
    assert await database.get_item(upload.item_id, "owner-a") is None
    assert all(path not in items_api.storage_service.objects for path in paths)
