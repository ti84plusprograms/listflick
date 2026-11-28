import io
from types import SimpleNamespace

import pytest
from PIL import Image

from app.api import recheck as recheck_api
from app.main import app
from app.models import database
from app.schemas.recheck import ListingTip, RecheckListingRequest, RecheckModelOutput
from app.services import listing_recheck
from app.services.ai_credentials import AIProviderCredentialInvalidError
from app.services.gemini_client import GeminiClientError


def _photo(color=(120, 90, 60), size=(640, 480)) -> bytes:
    img = Image.new("RGB", size, color)
    # Add edges so the pixel checks do not call it blurry.
    for x in range(0, size[0], 16):
        for y in range(size[1]):
            img.putpixel((x, y), (250, 250, 250))
    out = io.BytesIO()
    img.save(out, format="JPEG")
    return out.getvalue()


class FakeClient:
    def __init__(self, reply: dict | Exception):
        self.reply = reply
        self.calls: list[dict] = []

    async def generate_json(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.reply, Exception):
            raise self.reply
        return kwargs["schema_model"].model_validate(self.reply)


def _payload(**overrides) -> RecheckListingRequest:
    data = {
        "title": "Spigen Power Bank 10000mAh",
        "description": "Details:\n- USB-C\n\nCondition: Good, light wear.",
        "asking_price": 25,
        "tips": [
            {"text": "Add a close-up photo of the label.", "done": False},
            {"text": "Set an asking price.", "done": False},
            {"text": "Mention the capacity.", "done": True},
        ],
    }
    data.update(overrides)
    return RecheckListingRequest.model_validate(data)


def test_recheck_route_is_registered():
    assert "post" in app.openapi()["paths"]["/api/items/recheck"]


def test_model_output_is_lenient():
    output = RecheckModelOutput.model_validate(
        {
            "done": ["2", 3.0, "x", None],
            "new_suggestions": "Show the cable.",
            "image_quality_feedback": [{"image_index": "1", "overall_status": "POOR"}, "bad", {"image_index": None}],
        }
    )
    assert output.done == [2, 3]
    assert output.new_suggestions == ["Show the cable."]
    assert [(v.image_index, v.overall_status) for v in output.image_quality_feedback] == [(1, "poor")]


def test_prompt_mentions_photos_only_when_images_are_sent():
    with_images = listing_recheck.build_recheck_prompt(_payload(), image_count=3)
    text_only = listing_recheck.build_recheck_prompt(_payload(), image_count=0)
    assert "contact sheet of the seller's 3 current photos" in with_images
    assert "image_quality_feedback" in with_images
    assert "No photos are attached" in text_only
    assert "Leave photo suggestions as they are." in text_only
    assert "image_quality_feedback" not in text_only
    assert "3. Mention the capacity. (already done)" in text_only


def test_contact_sheet_is_one_jpeg_grid():
    sheet = listing_recheck.build_contact_sheet([_photo(), _photo((10, 10, 10)), b"not an image"], tile=100)
    img = Image.open(io.BytesIO(sheet))
    assert img.format == "JPEG"
    # 3 photos -> 2 columns x 2 rows of 100px tiles with an 8px gap.
    assert img.size == (208, 208)


@pytest.mark.asyncio
async def test_text_recheck_marks_text_tips_done_but_keeps_photo_tips_open():
    client = FakeClient({"done": [1, 2], "new_suggestions": ["Say if the cable is included.", "Set an asking price."]})
    response = await listing_recheck.recheck_listing_record(_payload(), [_photo()], ai=client)

    assert client.calls[0]["image_bytes"] is None
    assert [(tip.text, tip.done) for tip in response.tips] == [
        ("Add a close-up photo of the label.", False),
        ("Set an asking price.", True),
        ("Mention the capacity.", True),
        ("Say if the cable is included.", False),
    ]
    assert response.image_quality_feedback == []
    assert response.checked_images == 0


@pytest.mark.asyncio
async def test_photo_recheck_sends_contact_sheet_and_grades_each_photo():
    client = FakeClient(
        {
            "done": [1],
            "new_suggestions": ["One", "Two", "Three"],
            "image_quality_feedback": [
                {"image_index": 1, "overall_status": "good", "suggested_action": ""},
                {"image_index": 2, "overall_status": "poor", "suggested_action": "Retake in daylight"},
            ],
        }
    )
    response = await listing_recheck.recheck_listing_record(
        _payload(include_images=True),
        [_photo(), _photo()],
        ai=client,
    )

    assert client.calls[0]["image_bytes"][:2] == b"\xff\xd8"
    assert response.tips[0].done is True
    assert [tip.text for tip in response.tips[3:]] == ["One", "Two"]
    assert [fb.image_index for fb in response.image_quality_feedback] == [0, 1]
    assert response.image_quality_feedback[1].overall_status == "poor"
    assert response.image_quality_feedback[1].suggested_action == "Retake in daylight"
    assert response.checked_images == 2


@pytest.mark.asyncio
async def test_recheck_caps_total_tips():
    tips = [{"text": f"Tip {i}", "done": False} for i in range(6)]
    client = FakeClient({"done": [], "new_suggestions": ["Extra"]})
    response = await listing_recheck.recheck_listing_record(_payload(tips=tips), [], ai=client)
    assert len(response.tips) == 6


@pytest.mark.asyncio
async def test_recheck_maps_provider_errors():
    with pytest.raises(recheck_api.HTTPException) as bad_key:
        await listing_recheck.recheck_listing_record(
            _payload(), [], ai=FakeClient(AIProviderCredentialInvalidError("bad"))
        )
    assert bad_key.value.status_code == 502
    assert bad_key.value.detail["code"] == "AI_PROVIDER_CREDENTIAL_INVALID"

    with pytest.raises(recheck_api.HTTPException) as failed:
        await listing_recheck.recheck_listing_record(_payload(), [], ai=FakeClient(GeminiClientError("down")))
    assert failed.value.status_code == 502


def _use_test_db(monkeypatch):
    # conftest swaps database.get_item for an in-memory fake; the route imported the original.
    monkeypatch.setattr(recheck_api, "get_item", database.get_item)


@pytest.mark.asyncio
async def test_recheck_route_reads_owned_item_photos(monkeypatch, tmp_path):
    _use_test_db(monkeypatch)
    client = FakeClient({"done": [], "new_suggestions": [], "image_quality_feedback": []})
    monkeypatch.setattr(
        recheck_api,
        "ensure_ai_provider_configured",
        lambda *_args: (client, SimpleNamespace(provider="claude", source="device_byok")),
    )
    item = await database.create_item("/tmp/photo.jpg")

    async def fake_assets(paths, *, storage):
        assert paths == ["/tmp/photo.jpg"]
        return [SimpleNamespace(content=_photo())]

    monkeypatch.setattr(recheck_api, "image_assets_for_paths", fake_assets)

    response = await recheck_api.recheck_listing(
        _payload(item_id=item["id"], include_images=True),
        uid="legacy",
        ai_key="key",
        ai_provider="claude",
    )
    assert response.item_id == item["id"]
    assert response.checked_images == 1
    assert client.calls[0]["image_bytes"] is not None


@pytest.mark.asyncio
async def test_recheck_route_rejects_items_owned_by_someone_else(monkeypatch):
    _use_test_db(monkeypatch)
    client = FakeClient({"done": []})
    monkeypatch.setattr(
        recheck_api,
        "ensure_ai_provider_configured",
        lambda *_args: (client, SimpleNamespace(provider="gemini", source="server_fallback")),
    )
    item = await database.create_item("/tmp/photo.jpg", user_id="owner")
    with pytest.raises(recheck_api.HTTPException) as exc_info:
        await recheck_api.recheck_listing(_payload(item_id=item["id"]), uid="intruder", ai_key=None, ai_provider=None)
    assert exc_info.value.status_code == 404
    assert client.calls == []


def test_recheck_request_bounds_text_fields():
    from pydantic import ValidationError

    from app.schemas.recheck import RecheckListingRequest

    RecheckListingRequest(title="Oak desk", description="x" * 10000)
    for field, size in (("title", 301), ("description", 10001), ("condition", 61)):
        try:
            RecheckListingRequest(**{field: "x" * size})
        except ValidationError:
            continue
        raise AssertionError(f"{field} accepted {size} characters")
