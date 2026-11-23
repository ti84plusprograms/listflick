import asyncio
import io
from pathlib import Path

import pytest
from PIL import Image
from starlette.datastructures import Headers, UploadFile

from app.api import items as items_api
from app.models import database
from app.schemas.listing import GeneratedListing, PriceSuggestion, SaveListingRequest, TrashRequest, VisionAnalysis
from app.services.item_api_service import select_item_image_path, storage_http_exception
from app.services.storage import InMemoryStorage, StorageError, StorageErrorCode


def _make_image(width: int = 800, height: int = 600, offset: int = 0) -> bytes:
    img = Image.new("RGB", (width, height))
    pixels = img.load()
    for x in range(width):
        for y in range(height):
            pixels[x, y] = ((x * 5 + y * 3 + offset) % 255, (x + y + offset) % 255, 128)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _upload_file(name: str = "photo.jpg", offset: int = 0) -> UploadFile:
    return UploadFile(
        file=io.BytesIO(_make_image(offset=offset)),
        filename=name,
        headers=Headers({"content-type": "image/jpeg"}),
    )


def test_storage_http_mapping_preserves_retryable_provider_failures():
    missing = storage_http_exception(
        StorageError("missing", StorageErrorCode.NOT_FOUND),
        not_found_detail="missing",
        fallback_detail="temporary",
    )
    outage = storage_http_exception(
        StorageError("outage", StorageErrorCode.DOWNLOAD_FAILED, retryable=True),
        not_found_detail="missing",
        fallback_detail="temporary",
    )

    assert missing.status_code == 404
    assert outage.status_code == 503


def test_image_path_selection_preserves_database_order_and_404s_invalid_indices():
    item = {"image_paths_json": '["first.jpg", "second.jpg"]', "image_path": "legacy.jpg"}

    assert select_item_image_path(item, 1) == "second.jpg"

    with pytest.raises(items_api.HTTPException) as exc_info:
        select_item_image_path(item, -1)

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Image not found"


@pytest.mark.asyncio
async def test_upload_multiple_returns_structured_image_feedback(temp_db):
    response = await items_api.upload_images([_upload_file("front.jpg"), _upload_file("side.jpg")])

    assert response.item_id
    assert len(response.image_urls) == 2
    assert len(response.image_quality_feedback) == 2
    assert response.image_quality_feedback[0].image_id == f"{response.item_id}:0"
    assert response.image_quality_feedback[1].image_index == 1
    assert response.image_quality_feedback[0].overall_status in {"good", "needs_improvement"}


@pytest.mark.asyncio
async def test_idempotent_upload_returns_same_item_for_same_images(temp_db):
    first = await items_api.upload_images(
        [_upload_file("front.jpg")],
        uid="owner-a",
        idempotency_key="operation-1234",
    )
    second = await items_api.upload_images(
        [_upload_file("front.jpg")],
        uid="owner-a",
        idempotency_key="operation-1234",
    )

    assert first.item_id == second.item_id
    assert first.image_urls == second.image_urls
    assert second.status == "uploaded"


@pytest.mark.asyncio
async def test_idempotent_upload_rejects_changed_images(temp_db):
    await items_api.upload_images(
        [_upload_file("front.jpg")],
        uid="owner-a",
        idempotency_key="operation-1234",
    )

    with pytest.raises(items_api.HTTPException) as raised:
        await items_api.upload_images(
            [_upload_file("different.jpg", offset=80)],
            uid="owner-a",
            idempotency_key="operation-1234",
        )

    assert raised.value.status_code == 409


@pytest.mark.asyncio
async def test_idempotent_upload_reclaims_interrupted_upload(temp_db, monkeypatch):
    class FlakyStorage(InMemoryStorage):
        def __init__(self):
            super().__init__()
            self.fail_once = True

        async def stage_pending(
            self,
            item_id: str,
            images: list[bytes],
            *,
            replace_existing: bool = False,
        ) -> list[str]:
            if self.fail_once:
                self.fail_once = False
                self.objects[f"pending/{item_id}/1.jpg"] = b"partial"
                raise StorageError("temporary", StorageErrorCode.UPLOAD_FAILED, retryable=True)
            assert replace_existing is True
            return await super().stage_pending(
                item_id,
                images,
                replace_existing=replace_existing,
            )

    storage = FlakyStorage()
    monkeypatch.setattr(items_api, "storage_service", storage)

    with pytest.raises(items_api.HTTPException) as raised:
        await items_api.upload_images(
            [_upload_file()],
            uid="owner-a",
            idempotency_key="interrupted-operation",
        )
    assert raised.value.status_code == 502
    interrupted = (await database.list_items("owner-a"))[0]

    recovered = await items_api.upload_images(
        [_upload_file()],
        uid="owner-a",
        idempotency_key="interrupted-operation",
    )

    assert recovered.item_id == interrupted["id"]
    assert recovered.status == "uploaded"
    assert storage.objects[f"pending/{interrupted['id']}/1.jpg"] != b"partial"


@pytest.mark.asyncio
async def test_idempotent_upload_preserves_objects_when_database_completion_fails(temp_db, monkeypatch):
    storage = InMemoryStorage()
    monkeypatch.setattr(items_api, "storage_service", storage)
    actual_complete = database.complete_item_upload
    calls = 0

    async def fail_once(item_id, user_id, image_paths, feedback):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("database temporarily unavailable")
        await actual_complete(item_id, user_id, image_paths, feedback)

    monkeypatch.setattr(items_api, "complete_item_upload", fail_once)

    with pytest.raises(items_api.HTTPException) as raised:
        await items_api.upload_images(
            [_upload_file()],
            uid="owner-a",
            idempotency_key="completion-failure-operation",
        )

    assert raised.value.status_code == 500
    interrupted = (await database.list_items("owner-a"))[0]
    path = f"pending/{interrupted['id']}/1.jpg"
    assert path in storage.objects

    recovered = await items_api.upload_images(
        [_upload_file()],
        uid="owner-a",
        idempotency_key="completion-failure-operation",
    )

    assert recovered.item_id == interrupted["id"]
    assert path in storage.objects


@pytest.mark.asyncio
async def test_idempotency_keys_are_scoped_to_owner(temp_db):
    owner_a = await items_api.upload_images(
        [_upload_file()],
        uid="owner-a",
        idempotency_key="shared-operation",
    )
    owner_b = await items_api.upload_images(
        [_upload_file()],
        uid="owner-b",
        idempotency_key="shared-operation",
    )

    assert owner_a.item_id != owner_b.item_id


@pytest.mark.asyncio
async def test_concurrent_idempotent_uploads_share_one_item(temp_db):
    first, second = await asyncio.gather(
        items_api.upload_images(
            [_upload_file()],
            uid="owner-a",
            idempotency_key="concurrent-operation",
        ),
        items_api.upload_images(
            [_upload_file()],
            uid="owner-a",
            idempotency_key="concurrent-operation",
        ),
    )

    assert first.item_id == second.item_id
    matching = [
        item for item in await database.list_items("owner-a")
        if item.get("client_request_id") == "concurrent-operation"
    ]
    assert len(matching) == 1


@pytest.mark.asyncio
async def test_upload_rejects_invalid_idempotency_key(temp_db):
    with pytest.raises(items_api.HTTPException) as raised:
        await items_api.upload_images(
            [_upload_file()],
            uid="owner-a",
            idempotency_key="bad key",
        )

    assert raised.value.status_code == 400


@pytest.mark.asyncio
async def test_image_retrieval_returns_bytes_without_redirect(temp_db):
    object_path = "item-for-image-retrieval/item-for-image-retrieval-1.jpg"
    await items_api.storage_service.upload(object_path, _make_image())
    item = await database.create_item(object_path, user_id="legacy")
    response = await items_api.get_item_image_by_index(item["id"], 0, uid="legacy")

    assert response.status_code == 200
    assert response.body.startswith(b"\xff\xd8")
    assert response.media_type == "image/jpeg"
    assert response.headers["cache-control"] == "private, max-age=3600, immutable"


@pytest.mark.asyncio
async def test_item_lookup_is_owner_scoped(temp_db):
    item = await database.create_item("owner-a/image.jpg", user_id="owner-a")

    assert await database.get_item(item["id"], "owner-a") is not None
    assert await database.get_item(item["id"], "owner-b") is None


@pytest.mark.asyncio
async def test_images_stay_pending_until_save_then_promote(temp_db, monkeypatch):
    class DisabledNotion:
        is_configured = False

    monkeypatch.setattr(items_api, "notion_service", DisabledNotion())
    response = await items_api.upload_images([_upload_file("pending.jpg")])
    item = await database.get_item(response.item_id)
    assert item is not None
    pending_paths = database.item_image_paths(item)

    assert item["image_storage_state"] == "pending"
    assert all(path.startswith("pending/") for path in pending_paths)
    assert all(path in items_api.storage_service.objects for path in pending_paths)

    analysis = VisionAnalysis(item_name="Vintage jacket", condition="Good")
    listing = GeneratedListing(
        title="Vintage jacket",
        description="A good-condition vintage jacket.",
        price_suggestion=PriceSuggestion(recommended_price=45),
    )
    await database.update_item_analysis(response.item_id, analysis.model_dump(), listing.model_dump())

    await items_api.save_item_listing(
        response.item_id,
        SaveListingRequest(
            title=listing.title,
            description=listing.description,
            category="Clothing",
            condition="Good",
            asking_price=45,
        ),
    )

    saved_item = await database.get_item(response.item_id)
    assert saved_item is not None
    permanent_paths = database.item_image_paths(saved_item)
    assert saved_item["image_storage_state"] == "permanent"
    assert all(not path.startswith("pending/") for path in permanent_paths)
    assert all(path not in items_api.storage_service.objects for path in pending_paths)
    assert all(path in items_api.storage_service.objects for path in permanent_paths)


@pytest.mark.asyncio
async def test_trash_restore_and_permanently_delete_item(temp_db):
    response = await items_api.upload_images([_upload_file("trash.jpg")])
    item = await database.get_item(response.item_id)
    assert item is not None
    await database.update_item_analysis(
        response.item_id,
        VisionAnalysis(item_name="Test item").model_dump(),
        GeneratedListing(title="Test item", description="Description").model_dump(),
    )
    await items_api.save_item_listing(
        response.item_id,
        SaveListingRequest(title="Test item", description="Description"),
    )

    trash_response = await items_api.trash_item_endpoint(response.item_id, TrashRequest(retention_days=7))
    assert trash_response["item_id"] == response.item_id
    assert (await database.get_item(response.item_id))["status"] == "trashed"

    restore_response = await items_api.restore_item_endpoint(response.item_id)
    assert restore_response["status"] == "saved"
    assert (await database.get_item(response.item_id))["status"] == "saved"

    await items_api.trash_item_endpoint(response.item_id, TrashRequest(retention_days=30))
    paths = database.item_image_paths(await database.get_item(response.item_id))
    await items_api.permanently_delete_item(response.item_id)

    assert await database.get_item(response.item_id) is None
    assert all(path not in items_api.storage_service.objects for path in paths)


@pytest.mark.asyncio
async def test_item_response_includes_image_feedback(temp_db):
    temp_db.mkdir(parents=True, exist_ok=True)
    image_path = temp_db / "stored.jpg"
    image_path.write_bytes(_make_image())
    item = await database.create_item(str(image_path))

    response = await items_api.get_item_by_id(item["id"])

    assert len(response.image_quality_feedback) == 1
    assert response.image_quality_feedback[0].image_id == f"{item['id']}:0"
    assert response.image_quality_feedback[0].suggested_action


@pytest.mark.asyncio
async def test_replace_item_images_persists_order_and_removes_superseded_files(temp_db):
    original = await items_api.upload_images([_upload_file("original.jpg")])
    original_item = await database.get_item(original.item_id)
    assert original_item is not None
    original_paths = database.item_image_paths(original_item)

    response = await items_api.replace_item_images(
        original.item_id,
        [_upload_file("cover.jpg", offset=30), _upload_file("detail.jpg", offset=60)],
    )
    updated_item = await database.get_item(original.item_id)
    assert updated_item is not None
    updated_paths = database.item_image_paths(updated_item)

    assert len(updated_paths) == 2
    assert updated_paths != original_paths
    assert all(path not in items_api.storage_service.objects for path in original_paths)
    assert all(path in items_api.storage_service.objects for path in updated_paths)
    assert response.image_urls == [
        f"/api/items/{original.item_id}/image/0",
        f"/api/items/{original.item_id}/image/1",
    ]
    assert [item.image_index for item in response.image_quality_feedback] == [0, 1]
