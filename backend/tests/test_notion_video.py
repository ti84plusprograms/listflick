import json

import pytest

from app.models import database
from app.schemas.listing import GeneratedListing, PriceSuggestion, VisionAnalysis
from app.services import notion_service as notion_module
from app.services.analyze_service import sync_item_to_notion
from app.services.notion_service import (
    NOTION_PART_BYTES,
    VIDEO_TOO_LARGE_WARNING,
    VIDEO_UPLOAD_FAILED_WARNING,
    NotionAPIError,
    NotionService,
    NotionSyncResult,
    NotionVideo,
    build_notion_page_payload,
    media_note,
)
from app.services.storage import ImageAsset, InMemoryStorage


def _analysis() -> VisionAnalysis:
    return VisionAnalysis(item_name="Desk Lamp", condition="good", category="Home")


def _listing() -> GeneratedListing:
    return GeneratedListing(
        title="IKEA Desk Lamp",
        description="Works great.",
        price_suggestion=PriceSuggestion(min=10, max=15),
    )


def _video(size: int, *, cached: str | None = None, content: bytes | None = None) -> NotionVideo:
    data = content if content is not None else b"v" * size

    async def load() -> bytes:
        return data

    return NotionVideo(
        video_id="vid-1",
        filename="video.mp4",
        content_type="video/mp4",
        size_bytes=size,
        duration_seconds=12,
        load=load,
        cached_upload_id=cached,
    )


class FakeNotionHttp:
    """Records Notion requests; responds like the real API for the calls the service makes."""

    def __init__(self, *, limit: int | None = 5 * 1024 * 1024 * 1024, reject_video_with: str | None = None):
        self.limit = limit
        self.reject_video_with = reject_video_with
        self.json_calls: list[tuple[str, str, dict | None]] = []
        self.parts: list[tuple[str, dict, int]] = []
        self.uploads = 0
        self.page_children: list[dict] = []

    def request_json(self, url, *, method, payload):
        self.json_calls.append((method, url, payload))
        if url.endswith("/users/me"):
            if self.limit is None:
                raise NotionAPIError("HTTP 404: no bot info")
            return {"bot": {"workspace_limits": {"max_file_upload_size_in_bytes": self.limit}}}
        if url == notion_module.NOTION_FILE_UPLOAD_URL:
            self.uploads += 1
            if self.reject_video_with and payload.get("content_type") == "video/mp4":
                raise NotionAPIError(self.reject_video_with)
            upload_id = f"upload-{self.uploads}"
            return {"id": upload_id, "upload_url": f"https://api.notion.com/v1/file_uploads/{upload_id}/send"}
        if url.endswith("/complete"):
            return {"id": url.split("/")[-2], "status": "uploaded"}
        if "/children" in url and method == "GET":
            return {"results": self.page_children}
        return {}

    def request_multipart(self, url, asset, content_type, *, fields=None, timeout=30):
        self.parts.append((url, dict(fields or {}), len(asset.content)))
        return {"status": "uploaded"}


def _service(monkeypatch, http: FakeNotionHttp) -> NotionService:
    service = NotionService(api_key="secret", data_source_id="source", enabled=True)

    async def fake_to_thread(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    monkeypatch.setattr(notion_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(service, "_request_json", http.request_json)
    monkeypatch.setattr(service, "_request_multipart_file", http.request_multipart)
    return service


def test_payload_adds_video_after_photos_in_the_photos_property():
    payload = build_notion_page_payload(
        analysis=_analysis(),
        listing=_listing(),
        item_id="item-1",
        data_source_id="source",
        photo_file_upload_ids=["p1", "p2"],
        video_file_upload_id="v1",
        video_filename="video.mov",
    )

    assert [entry["file_upload"]["id"] for entry in payload["properties"]["Photos"]["files"]] == ["p1", "p2", "v1"]
    assert payload["properties"]["Photos"]["files"][-1]["name"] == "video.mov"


def test_media_note_text():
    assert media_note(has_video=False) == "Media for Facebook Marketplace: photos in order (photo 1 is the cover)."
    assert media_note(has_video=True) == (
        "Media for Facebook Marketplace: photos in order (photo 1 is the cover). "
        "Video: add it with Marketplace's 'Add video' button, not in the photos."
    )


@pytest.mark.asyncio
async def test_small_video_uses_single_part_and_lands_in_property_and_page_content(monkeypatch):
    http = FakeNotionHttp()
    service = _service(monkeypatch, http)
    created = {}
    monkeypatch.setattr(service, "_post_create_page", lambda payload: created.update(payload) or {"id": "page-1"})

    result = await service.create_listing_entry(
        item_id="item-1",
        analysis=_analysis(),
        listing=_listing(),
        image_assets=[ImageAsset(path="a.jpg", content=b"img")],
        video=_video(3 * 1024 * 1024),
    )

    file_uploads = [payload for method, url, payload in http.json_calls if url == notion_module.NOTION_FILE_UPLOAD_URL]
    assert [p["mode"] for p in file_uploads] == ["single_part", "single_part"]
    assert result.video_upload_id == "upload-2"
    assert result.warnings == ()
    files = created["properties"]["Photos"]["files"]
    assert [f["file_upload"]["id"] for f in files] == ["upload-1", "upload-2"]
    children = created["children"]
    assert children[0]["type"] == "paragraph"
    assert "'Add video' button" in children[0]["paragraph"]["rich_text"][0]["text"]["content"]
    assert children[1]["type"] == "video"
    assert children[1]["video"]["file_upload"] == {"id": "upload-2"}
    assert children[1]["video"]["caption"][0]["text"]["content"] == "Item video (0:12)"


@pytest.mark.asyncio
async def test_large_video_uses_multi_part_upload(monkeypatch):
    http = FakeNotionHttp()
    service = _service(monkeypatch, http)
    monkeypatch.setattr(service, "_post_create_page", lambda payload: {"id": "page-1"})
    size = 2 * NOTION_PART_BYTES + 1234

    result = await service.create_listing_entry(
        item_id="item-1", analysis=_analysis(), listing=_listing(), video=_video(size)
    )

    create = next(p for m, u, p in http.json_calls if u == notion_module.NOTION_FILE_UPLOAD_URL)
    assert create == {"mode": "multi_part", "number_of_parts": 3, "filename": "video.mp4", "content_type": "video/mp4"}
    assert [fields["part_number"] for _, fields, _ in http.parts] == ["1", "2", "3"]
    assert [length for _, _, length in http.parts] == [NOTION_PART_BYTES, NOTION_PART_BYTES, 1234]
    assert all(url.endswith("/upload-1/send") for url, _, _ in http.parts)
    assert ("POST", "https://api.notion.com/v1/file_uploads/upload-1/complete", {}) in http.json_calls
    assert result.video_upload_id == "upload-1"


@pytest.mark.asyncio
async def test_video_over_the_workspace_limit_is_skipped_but_the_listing_syncs(monkeypatch):
    http = FakeNotionHttp(limit=5 * 1024 * 1024)
    service = _service(monkeypatch, http)
    created = {}
    monkeypatch.setattr(service, "_post_create_page", lambda payload: created.update(payload) or {"id": "page-1"})
    loaded = []

    async def load():
        loaded.append(True)
        return b""

    video = NotionVideo("vid-1", "video.mp4", "video/mp4", 30 * 1024 * 1024, 20, load)
    result = await service.create_listing_entry(item_id="item-1", analysis=_analysis(), listing=_listing(), video=video)

    assert result.page_id == "page-1"
    assert result.video_upload_id is None
    assert result.warnings == (VIDEO_TOO_LARGE_WARNING,)
    assert not loaded, "the video is not read or uploaded when it cannot fit"
    assert "Photos" not in created["properties"]
    assert [child["type"] for child in created["children"]] == ["paragraph"]


@pytest.mark.asyncio
async def test_notion_validation_error_on_video_becomes_a_warning(monkeypatch):
    http = FakeNotionHttp(limit=None, reject_video_with='HTTP 400: {"code": "validation_error", "message": "file too large"}')
    service = _service(monkeypatch, http)
    monkeypatch.setattr(service, "_post_create_page", lambda payload: {"id": "page-1"})

    result = await service.create_listing_entry(item_id="item-1", analysis=_analysis(), listing=_listing(), video=_video(1000))

    assert result.page_id == "page-1"
    assert result.warnings == (VIDEO_TOO_LARGE_WARNING,)


@pytest.mark.asyncio
async def test_network_failure_on_video_is_a_warning_not_a_failed_sync(monkeypatch):
    http = FakeNotionHttp()
    service = _service(monkeypatch, http)
    monkeypatch.setattr(service, "_post_create_page", lambda payload: {"id": "page-1"})

    def broken_upload(*args, **kwargs):
        raise TimeoutError("timed out")

    monkeypatch.setattr(service, "_upload_bytes", broken_upload)
    result = await service.create_listing_entry(item_id="item-1", analysis=_analysis(), listing=_listing(), video=_video(1000))

    assert result.warnings == (VIDEO_UPLOAD_FAILED_WARNING,)


@pytest.mark.asyncio
async def test_update_reuses_saved_video_upload_and_keeps_existing_blocks(monkeypatch):
    http = FakeNotionHttp()
    http.page_children = [
        {"id": "b-note", "type": "paragraph", "paragraph": {"rich_text": [{"plain_text": media_note(has_video=True)}]}},
        {"id": "b-video", "type": "video", "video": {}},
    ]
    service = _service(monkeypatch, http)
    patched = {}
    monkeypatch.setattr(service, "_patch_update_page", lambda page_id, payload: patched.update(payload) or {"id": page_id})

    result = await service.create_listing_entry(
        item_id="item-1",
        analysis=_analysis(),
        listing=_listing(),
        existing_page_id="page-1",
        video=_video(1000, cached="upload-old"),
    )

    assert result.video_upload_id == "upload-old"
    assert http.uploads == 0, "the same video is not uploaded again"
    assert patched["properties"]["Photos"]["files"][-1]["file_upload"]["id"] == "upload-old"
    assert not any(method in {"DELETE", "PATCH"} for method, _, _ in http.json_calls)


@pytest.mark.asyncio
async def test_update_with_new_video_replaces_the_media_blocks(monkeypatch):
    http = FakeNotionHttp()
    http.page_children = [
        {"id": "b-text", "type": "paragraph", "paragraph": {"rich_text": [{"plain_text": "Seller notes"}]}},
        {"id": "b-note", "type": "paragraph", "paragraph": {"rich_text": [{"plain_text": media_note(has_video=False)}]}},
        {"id": "b-video", "type": "video", "video": {}},
    ]
    service = _service(monkeypatch, http)
    monkeypatch.setattr(service, "_patch_update_page", lambda page_id, payload: {"id": page_id})

    await service.create_listing_entry(
        item_id="item-1", analysis=_analysis(), listing=_listing(), existing_page_id="page-1", video=_video(1000)
    )

    deleted = [url for method, url, _ in http.json_calls if method == "DELETE"]
    assert deleted == ["https://api.notion.com/v1/blocks/b-note", "https://api.notion.com/v1/blocks/b-video"]
    appended = next(payload for method, url, payload in http.json_calls if method == "PATCH" and url.endswith("/children"))
    assert [child["type"] for child in appended["children"]] == ["paragraph", "video"]


@pytest.mark.asyncio
async def test_stale_saved_upload_is_uploaded_again_once(monkeypatch):
    http = FakeNotionHttp()
    service = _service(monkeypatch, http)
    writes = []

    def create(payload):
        ids = [f["file_upload"]["id"] for f in payload["properties"].get("Photos", {}).get("files", [])]
        writes.append(ids)
        if "upload-stale" in ids:
            raise NotionAPIError("HTTP 400: file upload expired")
        return {"id": "page-1"}

    monkeypatch.setattr(service, "_post_create_page", create)
    result = await service.create_listing_entry(
        item_id="item-1", analysis=_analysis(), listing=_listing(), video=_video(1000, cached="upload-stale")
    )

    assert writes == [["upload-stale"], ["upload-1"]]
    assert result.video_upload_id == "upload-1"


class VideoRecordingNotion:
    is_configured = True

    def __init__(self, warnings=()):
        self.kwargs = None
        self.warnings = warnings

    async def create_listing_entry(self, **kwargs):
        self.kwargs = kwargs
        return NotionSyncResult(
            page_id="page-1",
            page_url=None,
            video_upload_id=None if self.warnings else "upload-v",
            warnings=tuple(self.warnings),
        )


async def _item_with_video(storage: InMemoryStorage) -> dict:
    item = await database.create_item("item/photo.jpg", "legacy")
    storage.objects["item/photo.jpg"] = b"photo"
    storage.objects["item/video/v1.mp4"] = b"video-bytes"
    await database.update_item_video(item["id"], "legacy", {
        "id": "v1",
        "path": "item/video/v1.mp4",
        "content_type": "video/mp4",
        "size_bytes": 11,
        "duration_seconds": 9,
        "frames": [],
    })
    return await database.get_item(item["id"], "legacy")


async def _sync(item, notion, storage):
    return await sync_item_to_notion(
        item,
        _analysis(),
        _listing(),
        notion=notion,
        get_item_record=lambda id: database.get_item(id, "legacy"),
        update_notion_sync=database.update_item_notion_sync,
        claim_notion_sync=database.claim_item_notion_sync,
        finish_notion_sync=database.finish_item_notion_sync,
        storage=storage,
    )


@pytest.mark.asyncio
async def test_sync_passes_video_and_remembers_its_upload_for_next_time(temp_db):
    storage = InMemoryStorage()
    item = await _item_with_video(storage)
    notion = VideoRecordingNotion()

    status = await _sync(item, notion, storage)

    video = notion.kwargs["video"]
    assert video.video_id == "v1" and video.filename == "video.mp4" and video.cached_upload_id is None
    assert await video.load() == b"video-bytes"
    assert status.status == "synced" and status.warnings == []
    stored = database.item_notion_media(await database.get_item(item["id"], "legacy"))
    assert stored["file_upload_id"] == "upload-v"

    await _sync(await database.get_item(item["id"], "legacy"), notion, storage)
    assert notion.kwargs["video"].cached_upload_id == "upload-v"
    assert notion.kwargs["had_video"] is True


@pytest.mark.asyncio
async def test_sync_surfaces_video_warning_without_failing(temp_db):
    storage = InMemoryStorage()
    item = await _item_with_video(storage)

    status = await _sync(item, VideoRecordingNotion(warnings=[VIDEO_TOO_LARGE_WARNING]), storage)

    assert status.status == "synced"
    assert status.warnings == [VIDEO_TOO_LARGE_WARNING]
    refreshed = await database.get_item(item["id"], "legacy")
    assert json.loads(refreshed["notion_media_json"])["too_large"] is True


def test_only_size_errors_count_as_too_large():
    from app.services.notion_service import NotionAPIError, _is_size_rejection

    assert _is_size_rejection(NotionAPIError("HTTP 413: payload too large"))
    assert _is_size_rejection(NotionAPIError('HTTP 400: {"message": "file too large"}'))
    assert not _is_size_rejection(NotionAPIError('HTTP 400: {"code": "validation_error", "message": "content_type is invalid"}'))
    assert not _is_size_rejection(NotionAPIError("HTTP 500: internal error"))
