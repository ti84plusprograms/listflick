import io
import json

import pytest
from fastapi import HTTPException
from PIL import Image, ImageDraw
from starlette.datastructures import Headers, UploadFile

from app.api import items as items_api
from app.config import settings
from app.models import database
from app.schemas.listing import GeneratedListing, PriceSuggestion, VisionAnalysis
from app.services.account_deletion import delete_user_data
from app.services.analyze_service import analyze_item_record, plan_analysis_media
from app.services.groq_client import GROQ_MAX_IMAGES
from app.services.storage import InMemoryStorage
from app.services.video_service import ranged_response


def _jpeg_bytes(color, layout=0, size=(640, 480)) -> bytes:
    image = Image.new("RGB", size, color)
    draw = ImageDraw.Draw(image)
    x0, y0 = 40 + layout * 70, 60 + (layout % 3) * 40
    for i in range(12):
        for j in range(12):
            fill = (250, 250, 250) if (i + j) % 2 else (15, 15, 15)
            draw.rectangle([x0 + i * 10, y0 + j * 10, x0 + i * 10 + 9, y0 + j * 10 + 9], fill=fill)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


def _image_upload(name: str, content: bytes) -> UploadFile:
    return UploadFile(file=io.BytesIO(content), filename=name, headers=Headers({"content-type": "image/jpeg"}))


def _video_upload(content: bytes = b"\x00\x00\x00\x18ftypmp42fake-video", *, content_type="video/mp4", name="clip.mp4"):
    return UploadFile(file=io.BytesIO(content), filename=name, headers=Headers({"content-type": content_type}))


def _frames(count: int = 6) -> list[UploadFile]:
    colors = [(200, 40, 40), (40, 200, 40), (40, 40, 200), (200, 200, 40), (40, 200, 200), (200, 40, 200)]
    return [_image_upload(f"frame-{i}.jpg", _jpeg_bytes(colors[i % len(colors)], layout=i % 5)) for i in range(count)]


async def _item_with_photo() -> str:
    upload = await items_api.upload_images([_image_upload("photo.jpg", _jpeg_bytes((120, 90, 60)))])
    return upload.item_id


@pytest.mark.asyncio
async def test_put_video_stores_video_and_selected_frames_and_exposes_it_on_the_item(temp_db):
    item_id = await _item_with_photo()
    storage = items_api.storage_service

    response = await items_api.upload_item_video(
        item_id,
        file=_video_upload(),
        frames=_frames(6),
        frame_times="[0.2, 1.0, 1.8, 2.6, 3.4, 4.2]",
        duration=4.5,
        uid="legacy",
    )

    assert response.video is not None
    assert response.video.content_type == "video/mp4"
    assert response.video.duration_seconds == 4.5
    assert 3 <= response.video.frame_count <= 6
    assert response.video.url == f"/api/items/{item_id}/video/{response.video.id}"
    assert response.video.cover_from_video is False

    item = await database.get_item(item_id)
    video = json.loads(item["video_json"])
    assert video["path"] == f"{item_id}/video/{video['id']}.mp4"
    assert storage.objects[video["path"]].startswith(b"\x00\x00\x00\x18ftyp")
    assert all(frame["path"] in storage.objects for frame in video["frames"])
    assert [frame["time"] for frame in video["frames"]] == sorted(frame["time"] for frame in video["frames"])

    fetched = await items_api.get_item_by_id(item_id, uid="legacy")
    assert fetched.video is not None and fetched.video.id == video["id"]


@pytest.mark.asyncio
async def test_second_video_replaces_the_first_and_removes_its_files(temp_db):
    item_id = await _item_with_photo()
    storage = items_api.storage_service
    first = await items_api.upload_item_video(item_id, file=_video_upload(b"first"), frames=_frames(4), frame_times="0,1,2,3", duration=3, uid="legacy")
    first_paths = database.item_video_paths(await database.get_item(item_id))

    second = await items_api.upload_item_video(item_id, file=_video_upload(b"second", content_type="video/quicktime", name="b.mov"), frames=[], frame_times=None, duration=2, uid="legacy")

    assert second.video.id != first.video.id
    assert second.video.content_type == "video/quicktime"
    assert all(path not in storage.objects for path in first_paths)
    assert all(path in storage.deleted for path in first_paths)


@pytest.mark.asyncio
async def test_video_limits_reject_wrong_types_and_oversized_files(temp_db, monkeypatch):
    item_id = await _item_with_photo()

    with pytest.raises(HTTPException) as wrong_type:
        await items_api.upload_item_video(item_id, file=_video_upload(content_type="video/x-msvideo", name="a.avi"), frames=[], uid="legacy")
    assert wrong_type.value.status_code == 415

    monkeypatch.setattr(settings, "max_video_upload_mb", 1)
    with pytest.raises(HTTPException) as too_big:
        await items_api.upload_item_video(item_id, file=_video_upload(b"x" * (1024 * 1024 + 1)), frames=[], uid="legacy")
    assert too_big.value.status_code == 413
    assert "1 MB" in too_big.value.detail

    with pytest.raises(HTTPException) as bad_frame:
        await items_api.upload_item_video(
            item_id,
            file=_video_upload(),
            frames=[UploadFile(file=io.BytesIO(b"x"), filename="f.txt", headers=Headers({"content-type": "text/plain"}))],
            uid="legacy",
        )
    assert bad_frame.value.status_code == 400

    # A generic content type is accepted when the file name is a known video type.
    accepted = await items_api.upload_item_video(
        item_id, file=_video_upload(content_type="application/octet-stream", name="clip.m4v"), frames=[], uid="legacy"
    )
    assert accepted.video.content_type == "video/x-m4v"


@pytest.mark.asyncio
async def test_video_is_scoped_to_the_owner(temp_db):
    item_id = await _item_with_photo()

    with pytest.raises(HTTPException) as other_user:
        await items_api.upload_item_video(item_id, file=_video_upload(), frames=[], uid="someone-else")
    assert other_user.value.status_code == 404


@pytest.mark.asyncio
async def test_video_only_listing_uses_sharpest_frame_as_cover_and_is_idempotent(temp_db):
    storage = items_api.storage_service
    frames = _frames(6)
    frames.insert(0, _image_upload("blurry.jpg", _jpeg_bytes((90, 90, 90), size=(64, 48))))

    created = await items_api.upload_video_listing(
        file=_video_upload(b"only-video"),
        frames=frames,
        frame_times="0.1,0.6,1.2,1.8,2.4,3.0,3.6",
        duration=4,
        uid="legacy",
        idempotency_key="video-op-123456",
    )
    item = await database.get_item(created.item_id)
    video = json.loads(item["video_json"])
    image_paths = database.item_image_paths(item)

    assert created.video.cover_from_video is True
    assert image_paths == [f"pending/{created.item_id}/1.jpg"]
    assert video["cover_frame_path"] == image_paths[0]
    assert image_paths[0] in storage.objects
    assert video["frames"], "the remaining frames are kept for analysis"
    assert item["status"] == "uploaded"

    retried = await items_api.upload_video_listing(
        file=_video_upload(b"only-video"),
        frames=_frames(3),
        frame_times="0,1,2",
        duration=4,
        uid="legacy",
        idempotency_key="video-op-123456",
    )
    assert retried.item_id == created.item_id
    assert retried.video.id == created.video.id

    with pytest.raises(HTTPException) as conflict:
        await items_api.upload_video_listing(
            file=_video_upload(b"another-video"), frames=_frames(2), frame_times="0,1", duration=2,
            uid="legacy", idempotency_key="video-op-123456",
        )
    assert conflict.value.status_code == 409

    fetched = await items_api.get_item_by_id(created.item_id, uid="legacy")
    assert fetched.image_quality_feedback == [], "a cover taken from the video gets no photo feedback"


@pytest.mark.asyncio
async def test_video_only_listing_without_usable_frames_is_rejected(temp_db):
    with pytest.raises(HTTPException) as exc:
        await items_api.upload_video_listing(file=_video_upload(), frames=[], frame_times=None, duration=3, uid="legacy", idempotency_key=None)
    assert exc.value.status_code == 422
    assert "Couldn't read that video" in exc.value.detail


@pytest.mark.asyncio
async def test_delete_video_endpoint_and_item_delete_remove_video_files(temp_db):
    storage = items_api.storage_service
    item_id = await _item_with_photo()
    await items_api.upload_item_video(item_id, file=_video_upload(), frames=_frames(3), frame_times="0,1,2", duration=3, uid="legacy")
    paths = database.item_video_paths(await database.get_item(item_id))

    await items_api.delete_item_video(item_id, uid="legacy")
    assert (await database.get_item(item_id))["video_json"] is None
    assert all(path not in storage.objects for path in paths)

    await items_api.upload_item_video(item_id, file=_video_upload(b"again"), frames=_frames(3), frame_times="0,1,2", duration=3, uid="legacy")
    paths = database.item_video_paths(await database.get_item(item_id))
    await database.trash_item(item_id, "legacy", "2000-01-01T00:00:00+00:00")
    await items_api.permanently_delete_item(item_id, uid="legacy")
    assert all(path not in storage.objects for path in paths)


@pytest.mark.asyncio
async def test_discarding_a_draft_removes_its_video(temp_db):
    storage = items_api.storage_service
    item_id = await _item_with_photo()
    await items_api.upload_item_video(item_id, file=_video_upload(), frames=_frames(2), frame_times="0,1", duration=2, uid="legacy")
    paths = database.item_video_paths(await database.get_item(item_id))

    await items_api.discard_item_draft(item_id, uid="legacy")

    assert all(path not in storage.objects for path in paths)


@pytest.mark.asyncio
async def test_account_deletion_removes_video_and_frames():
    storage = InMemoryStorage()
    video = {"id": "v1", "path": "item-1/video/v1.mp4", "frames": [{"path": "item-1/video/v1-frame-1.jpg", "time": 0.5, "rank": 0}]}
    for path in ("item-1/one.jpg", video["path"], video["frames"][0]["path"]):
        storage.objects[path] = b"x"
    records = [{
        "id": "item-1",
        "image_storage_state": "permanent",
        "image_paths_json": json.dumps(["item-1/one.jpg"]),
        "video_json": json.dumps(video),
    }]

    async def list_items(uid):
        return records

    async def delete_items(uid):
        return None

    await delete_user_data("uid", list_items=list_items, delete_items=delete_items, storage=storage)

    assert storage.objects == {}


@pytest.mark.asyncio
async def test_video_url_and_ranged_download(temp_db):
    item_id = await _item_with_photo()
    response = await items_api.upload_item_video(item_id, file=_video_upload(b"0123456789"), frames=[], uid="legacy")
    video_id = response.video.id

    signed = await items_api.get_item_video_url(item_id, video_id, uid="legacy")
    assert signed["url"].startswith("https://storage.test/")

    with pytest.raises(HTTPException) as stale:
        await items_api.get_item_video_url(item_id, "old-video-id", uid="legacy")
    assert stale.value.status_code == 404

    class FakeRequest:
        headers = {"range": "bytes=2-5"}

    partial = await items_api.get_item_video(item_id, video_id, FakeRequest(), uid="legacy")
    assert partial.status_code == 206
    assert partial.body == b"2345"
    assert partial.headers["content-range"] == "bytes 2-5/10"


def test_ranged_response_handles_full_suffix_and_unsatisfiable_ranges():
    content = b"abcdefghij"
    assert ranged_response(content, "video/mp4", None).body == content
    assert ranged_response(content, "video/mp4", "bytes=-3").body == b"hij"
    assert ranged_response(content, "video/mp4", "bytes=7-").body == b"hij"
    assert ranged_response(content, "video/mp4", "bytes=20-").status_code == 416


def test_plan_analysis_media_puts_photos_first_and_respects_budgets():
    photos = [b"p%d" % i for i in range(8)]
    frames = [(b"f%d" % i, float(i), rank) for i, rank in enumerate([3, 0, 4, 1, 5, 2])]

    used, chosen = plan_analysis_media(photos[:2], frames)
    assert used == photos[:2]
    assert [f[1] for f in chosen] == [0.0, 1.0, 2.0, 3.0, 4.0, 5.0]

    used, chosen = plan_analysis_media(photos[:5], frames)
    assert len(used) == 5
    # Budget is 3 frames: the three best-ranked (ranks 0, 1, 2), sorted by time.
    assert [f[1] for f in chosen] == [1.0, 3.0, 5.0]

    used, chosen = plan_analysis_media(photos, frames)
    assert len(chosen) == 2 and len(used) == 6, "8 photos make room for at least 2 frames"

    used, chosen = plan_analysis_media(photos[:4], frames, max_images=GROQ_MAX_IMAGES)
    assert len(used) + len(chosen) == GROQ_MAX_IMAGES
    assert len(chosen) == 2

    used, chosen = plan_analysis_media(photos[:3], frames, max_images=8, max_total_bytes=8)
    assert used == photos[:3] and len(chosen) == 1

    assert plan_analysis_media(photos[:3], []) == (photos[:3], [])


class RecordingVisionAI:
    provider = "gemini"

    def __init__(self):
        self.calls = []

    async def analyze_images(self, images, **kwargs):
        self.calls.append((list(images), kwargs))
        return VisionAnalysis(item_name="Lamp", condition="good", category="Home")

    async def analyze_image_bytes(self, image_bytes):
        raise AssertionError("the multi-image path should be used")

    async def generate_listing(self, analysis):
        return GeneratedListing(title="Lamp", description="Lamp", price_suggestion=PriceSuggestion(min=10, max=20))


@pytest.mark.asyncio
async def test_analysis_sends_photos_then_video_frames_with_times(temp_db):
    item_id = await _item_with_photo()
    await items_api.upload_item_video(
        item_id, file=_video_upload(), frames=_frames(6), frame_times="0.2,1,1.8,2.6,3.4,4.2", duration=4.6, uid="legacy"
    )
    item = await database.get_item(item_id)
    ai = RecordingVisionAI()

    await analyze_item_record(item, ai=ai, update_analysis=database.update_item_analysis, storage=items_api.storage_service)

    images, kwargs = ai.calls[0]
    video = json.loads(item["video_json"])
    assert len(images) == 1
    assert len(kwargs["video_frames"]) == len(video["frames"])
    assert kwargs["frame_times"] == sorted(kwargs["frame_times"])
    assert kwargs["video_duration"] == 4.6
    assert kwargs["cover_from_video"] is False


def test_vision_prompt_labels_photos_and_frames():
    from app.prompts.vision import VISION_USER_PROMPT, vision_user_prompt

    prompt = vision_user_prompt(2, [0.5, 2.0, 4.0], 4.6)
    assert "Images 1 to 2 are the seller's photos (image 1 is the cover)." in prompt
    assert "Images 3 to 5 are still frames from the seller's 5-second video of the item, taken at 0.5s, 2.0s, 4.0s." in prompt
    assert "A frame only proves what it visibly shows." in prompt
    assert "powered on, lights, screen, moving parts" in prompt
    assert "Image 2 is a still frame" in vision_user_prompt(1, [1.0], 2)
    assert "a still taken from the seller's video" in vision_user_prompt(1, [1.0, 2.0], 3, cover_from_video=True)
    assert vision_user_prompt(3, [], 0) == VISION_USER_PROMPT


@pytest.mark.asyncio
async def test_ai_service_appends_frames_after_photos_with_video_prompt():
    from app.services.ai_service import AIService

    captured = {}

    class Client:
        async def generate_json(self, **kwargs):
            captured.update(kwargs)
            return VisionAnalysis(item_name="Lamp", condition="good")

    service = AIService(client=Client(), provider="claude")
    await service.analyze_images([b"photo-1", b"photo-2"], video_frames=[b"frame-1"], frame_times=[1.5], video_duration=3)

    assert captured["images"] == [b"photo-1", b"photo-2", b"frame-1"]
    assert "Image 3 is a still frame from the seller's 3-second video" in captured["user_prompt"]


@pytest.mark.asyncio
async def test_saving_a_video_only_listing_keeps_the_cover_marked_as_a_video_still(temp_db):
    from app.schemas.listing import SaveListingRequest

    created = await items_api.upload_video_listing(
        file=_video_upload(b"only-video"),
        frames=_frames(4),
        frame_times="0.5,1.5,2.5,3.5",
        duration=4,
        uid="legacy",
        idempotency_key="video-op-save-cover",
    )
    listing = GeneratedListing(
        title="Desk lamp",
        description="Works well.",
        price_suggestion=PriceSuggestion(recommended_price=20),
    )
    await database.update_item_analysis(created.item_id, {}, listing.model_dump())

    await items_api.save_item_listing(
        created.item_id,
        SaveListingRequest(title="Desk lamp", description="Works well.", category="Home", condition="Good", asking_price=20),
        uid="legacy",
    )

    item = await database.get_item(created.item_id)
    video = json.loads(item["video_json"])
    image_paths = database.item_image_paths(item)
    assert not image_paths[0].startswith("pending/")
    assert video["cover_frame_path"] == image_paths[0]
    fetched = await items_api.get_item_by_id(created.item_id, uid="legacy")
    assert fetched.video.cover_from_video is True
    assert fetched.image_quality_feedback == []


@pytest.mark.asyncio
async def test_video_uploads_declaring_too_large_a_body_are_refused_before_reading_it(monkeypatch):
    from app.utils.body_limit import VideoUploadSizeLimitMiddleware, video_request_body_limit

    monkeypatch.setattr(settings, "max_video_upload_mb", 1)
    reached_app: list[str] = []

    async def app(scope, receive, send):
        reached_app.append(scope["path"])

    async def receive():
        raise AssertionError("the body must not be read")

    sent: list[dict] = []

    async def send(message):
        sent.append(message)

    middleware = VideoUploadSizeLimitMiddleware(app)
    too_big = str(video_request_body_limit() + 1).encode()
    for method, path in (("POST", "/api/items/upload-video"), ("PUT", "/api/items/abc/video")):
        sent.clear()
        scope = {"type": "http", "method": method, "path": path, "headers": [(b"content-length", too_big)]}
        await middleware(scope, receive, send)
        assert sent[0]["status"] == 413
    assert reached_app == []

    ok = {"type": "http", "method": "PUT", "path": "/api/items/abc/video", "headers": [(b"content-length", b"1000")]}
    await middleware(ok, receive, send)
    other = {"type": "http", "method": "POST", "path": "/api/items/upload", "headers": [(b"content-length", too_big)]}
    await middleware(other, receive, send)
    assert reached_app == ["/api/items/abc/video", "/api/items/upload"]
