import asyncio
import io
import json

import pytest
from PIL import Image
from starlette.datastructures import Headers, UploadFile

from app.api import items as items_api
from app.config import settings
from app.models import database
from app.schemas.listing import GeneratedListing, PriceSuggestion, VisionAnalysis
from app.services.notion_service import NotionAPIError, NotionSyncResult


def _analysis() -> VisionAnalysis:
    return VisionAnalysis(
        item_name="Power Bank",
        brand="Spigen",
        condition="like new",
        category="Electronics",
        confidence=0.8,
    )


def _listing(title: str = "Spigen Power Bank") -> GeneratedListing:
    return GeneratedListing(
        title=title,
        description="🔹 Features:\n- Portable charger\n\n💵 Price: $25\n\n✅ Condition: Like New\n\n📍 Pickup Details:\n- Location: [Insert Pickup Location]\n- Payment: [Insert Payment Methods]",
        marketplace_category="Electronics",
        tags=["charger"],
        price_suggestion=PriceSuggestion(min=25, max=25),
    )


class SuccessfulNotionService:
    is_configured = True

    async def create_listing_entry(self, **kwargs):
        return NotionSyncResult(page_id="page-123", page_url="https://notion.so/page-123")


class FailingNotionService:
    is_configured = True

    async def create_listing_entry(self, **kwargs):
        raise NotionAPIError("Notion rejected the listing fields.")


class RetryNotionService:
    is_configured = True

    def __init__(self):
        self.calls = 0

    async def create_listing_entry(self, **kwargs):
        self.calls += 1
        if self.calls == 1:
            raise NotionAPIError("Could not reach Notion. Check your connection and try again.")
        return NotionSyncResult(page_id="page-456", page_url="https://notion.so/page-456")


class RecordingNotionService:
    is_configured = True

    def __init__(self):
        self.image_paths: list[str] = []

    async def create_listing_entry(self, **kwargs):
        self.image_paths = [asset.path for asset in kwargs["image_assets"]]
        return NotionSyncResult(page_id="page-photos", page_url=None)


class CountingNotionService:
    is_configured = True

    def __init__(self):
        self.calls = 0

    async def create_listing_entry(self, **kwargs):
        self.calls += 1
        return NotionSyncResult(page_id="page-counted", page_url=None)


class AmbiguousThenReconciledNotionService:
    is_configured = True

    def __init__(self):
        self.reconcile_values: list[bool] = []

    async def create_listing_entry(self, **kwargs):
        self.reconcile_values.append(kwargs["reconcile_ambiguous"])
        if len(self.reconcile_values) == 1:
            raise NotionAPIError("Notion sync timed out. Please try again.", code="timeout")
        return NotionSyncResult(
            page_id="page-reconciled",
            page_url="https://notion.so/page-reconciled",
        )


class BlockingNotionService:
    is_configured = True

    def __init__(self):
        self.calls = 0
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def create_listing_entry(self, **kwargs):
        self.calls += 1
        self.started.set()
        await self.release.wait()
        return NotionSyncResult(page_id="page-once", page_url=None)


def _upload_file(name: str, offset: int) -> UploadFile:
    image = Image.new("RGB", (800, 600))
    pixels = image.load()
    for x in range(800):
        for y in range(600):
            pixels[x, y] = ((x * 5 + y * 3 + offset) % 255, (x + y + offset) % 255, 128)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return UploadFile(
        file=io.BytesIO(buffer.getvalue()),
        filename=name,
        headers=Headers({"content-type": "image/jpeg"}),
    )


@pytest.mark.asyncio
async def test_save_listing_records_successful_notion_sync(monkeypatch, temp_db):
    monkeypatch.setattr(items_api, "notion_service", SuccessfulNotionService())
    item = await database.create_item("/tmp/photo.jpg")
    await database.update_item_analysis(item["id"], _analysis().model_dump(), _listing().model_dump())

    response = await items_api.save_item_listing(
        item["id"],
        items_api.SaveListingRequest(
            title="Spigen Power Bank",
            description="Listing description",
            category="Electronics",
            condition="Like New",
            asking_price=25,
        ),
    )

    assert response.notion_sync.status == "synced"
    assert response.notion_sync.page_id == "page-123"
    assert response.notion_sync.page_url == "https://notion.so/page-123"
    fetched = await items_api.get_item_by_id(item["id"], uid="legacy")
    assert fetched.notion_sync.status == "synced"
    assert fetched.notion_sync.page_id == "page-123"


@pytest.mark.asyncio
async def test_developer_notion_override_can_disable_sync_without_disabling_save(monkeypatch, temp_db):
    service = CountingNotionService()
    monkeypatch.setattr(items_api, "notion_service", service)
    monkeypatch.setattr(settings, "notion_allow_client_override", True)
    item = await database.create_item("/tmp/photo.jpg")
    await database.update_item_analysis(item["id"], _analysis().model_dump(), _listing().model_dump())

    response = await items_api.save_item_listing(
        item["id"],
        items_api.SaveListingRequest(
            title="Saved Without Notion",
            description="Still saved in inventory.",
            category="Electronics",
            condition="Good",
            asking_price=20,
            notion_sync_enabled=False,
        ),
    )

    saved_item = await database.get_item(item["id"])
    fetched = await items_api.get_item_by_id(item["id"], uid="legacy")
    assert response.notion_sync.status == "not_synced"
    assert response.notion_sync.reason == "client_disabled"
    assert fetched.notion_sync.reason == "client_disabled"
    assert service.calls == 0
    assert saved_item is not None
    assert saved_item["status"] == "saved"
    assert saved_item["notion_sync_reason"] == "client_disabled"


@pytest.mark.asyncio
async def test_client_disable_is_ignored_when_backend_override_is_disallowed(monkeypatch, temp_db):
    service = CountingNotionService()
    monkeypatch.setattr(items_api, "notion_service", service)
    monkeypatch.setattr(settings, "notion_allow_client_override", False)
    item = await database.create_item("/tmp/photo.jpg")
    await database.update_item_analysis(item["id"], _analysis().model_dump(), _listing().model_dump())

    await items_api.save_item_listing(
        item["id"],
        items_api.SaveListingRequest(
            title="Server Controlled",
            description="Server policy remains authoritative.",
            notion_sync_enabled=False,
        ),
    )

    assert service.calls == 1


@pytest.mark.asyncio
async def test_save_listing_records_failed_notion_sync_and_preserves_listing(monkeypatch, temp_db):
    monkeypatch.setattr(items_api, "notion_service", FailingNotionService())
    item = await database.create_item("/tmp/photo.jpg")
    await database.update_item_analysis(item["id"], _analysis().model_dump(), _listing().model_dump())

    response = await items_api.save_item_listing(
        item["id"],
        items_api.SaveListingRequest(
            title="Saved Locally",
            description="Local listing remains saved.",
            category="Electronics",
            condition="Good",
            asking_price=20,
        ),
    )
    saved_item = await database.get_item(item["id"])

    assert response.notion_sync.status == "failed"
    assert response.notion_sync.error_code == "schema"
    assert response.notion_sync.last_error == "Notion rejected the listing fields."
    assert saved_item is not None
    assert saved_item["status"] == "saved"
    assert json.loads(saved_item["listing_json"])["title"] == "Saved Locally"
    fetched = await items_api.get_item_by_id(item["id"], uid="legacy")
    assert fetched.notion_sync.status == "failed"
    assert fetched.notion_sync.error_code == "schema"


@pytest.mark.asyncio
async def test_save_listing_returns_backend_error_when_persistence_fails(monkeypatch, temp_db):
    monkeypatch.setattr(items_api, "notion_service", SuccessfulNotionService())
    item = await database.create_item("/tmp/photo.jpg")
    await database.update_item_analysis(item["id"], _analysis().model_dump(), _listing().model_dump())

    async def fail_update_item_analysis(*args, **kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(items_api, "update_item_analysis", fail_update_item_analysis)

    with pytest.raises(items_api.HTTPException) as exc_info:
        await items_api.save_item_listing(
            item["id"],
            items_api.SaveListingRequest(
                title="Saved Locally",
                description="Local listing remains saved.",
                category="Electronics",
                condition="Good",
                asking_price=20,
            ),
        )

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Could not save listing"


@pytest.mark.asyncio
async def test_retry_notion_sync_after_failure(monkeypatch, temp_db):
    service = RetryNotionService()
    monkeypatch.setattr(items_api, "notion_service", service)
    item = await database.create_item("/tmp/photo.jpg")
    await database.update_item_analysis(item["id"], _analysis().model_dump(), _listing().model_dump(), status="saved")

    failed = await items_api.retry_item_notion_sync(item["id"])
    retried = await items_api.retry_item_notion_sync(item["id"])

    assert failed.notion_sync.status == "failed"
    assert retried.notion_sync.status == "synced"
    assert retried.notion_sync.page_id == "page-456"
    assert service.calls == 2


@pytest.mark.asyncio
async def test_retry_reconciles_ambiguous_create_and_clears_marker(monkeypatch, temp_db):
    service = AmbiguousThenReconciledNotionService()
    monkeypatch.setattr(items_api, "notion_service", service)
    item = await database.create_item("/tmp/photo.jpg")
    await database.update_item_analysis(
        item["id"],
        _analysis().model_dump(),
        _listing().model_dump(),
        status="saved",
    )

    failed = await items_api.retry_item_notion_sync(item["id"])
    failed_item = await database.get_item(item["id"])
    retried = await items_api.retry_item_notion_sync(item["id"])
    synced_item = await database.get_item(item["id"])

    assert failed.notion_sync.status == "failed"
    assert failed_item is not None
    assert failed_item["notion_create_ambiguous"] is True
    assert retried.notion_sync.status == "synced"
    assert retried.notion_sync.page_id == "page-reconciled"
    assert synced_item is not None
    assert synced_item["notion_create_ambiguous"] is False
    assert service.reconcile_values == [False, True]


@pytest.mark.asyncio
async def test_concurrent_retries_share_one_notion_write_lease(monkeypatch, temp_db):
    service = BlockingNotionService()
    monkeypatch.setattr(items_api, "notion_service", service)
    item = await database.create_item("/tmp/photo.jpg")
    await database.update_item_analysis(
        item["id"],
        _analysis().model_dump(),
        _listing().model_dump(),
        status="saved",
    )

    first_task = asyncio.create_task(items_api.retry_item_notion_sync(item["id"]))
    await service.started.wait()
    concurrent = await items_api.retry_item_notion_sync(item["id"])
    service.release.set()
    first = await first_task

    assert concurrent.notion_sync.status == "syncing"
    assert first.notion_sync.status == "synced"
    assert service.calls == 1


@pytest.mark.asyncio
async def test_save_listing_sends_replacement_images_to_notion(monkeypatch, temp_db):
    service = RecordingNotionService()
    monkeypatch.setattr(items_api, "notion_service", service)
    upload = await items_api.upload_images([_upload_file("original.jpg", 0)])
    await items_api.replace_item_images(
        upload.item_id,
        [_upload_file("cover.jpg", 30), _upload_file("detail.jpg", 60)],
    )
    await database.update_item_analysis(upload.item_id, _analysis().model_dump(), _listing().model_dump())

    await items_api.save_item_listing(
        upload.item_id,
        items_api.SaveListingRequest(
            title="Spigen Power Bank",
            description="Listing description",
            category="Electronics",
            condition="Like New",
            asking_price=25,
        ),
    )
    item = await database.get_item(upload.item_id)

    assert item is not None
    assert service.image_paths == database.item_image_paths(item)
    assert len(service.image_paths) == 2
