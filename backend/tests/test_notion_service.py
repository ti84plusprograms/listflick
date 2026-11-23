import ssl
from unittest.mock import MagicMock
from urllib.error import URLError

import pytest

from app.schemas.listing import GeneratedListing, PriceSuggestion, VisionAnalysis
from app.services import notion_service as notion_module
from app.services.notion_service import (
    MANUAL_INPUT_PENDING,
    NotionAPIError,
    NotionService,
    build_notion_page_payload,
    notion_error_code,
    user_readable_notion_error,
)
from app.services.notion_status import notion_error_code_from_message
from app.services.storage import ImageAsset


def _analysis(condition: str = "like new") -> VisionAnalysis:
    return VisionAnalysis(
        item_name="Wireless Power Bank",
        brand="Spigen",
        condition=condition,
        category="Electronics",
        confidence=0.8,
        detected_attributes=["black"],
        visible_defects=[],
    )


def _listing() -> GeneratedListing:
    return GeneratedListing(
        title="Spigen ArcPack Wireless Power Bank + Dock",
        description="Spigen wireless power bank and dock in like new condition.",
        marketplace_category="Electronics",
        tags=["power bank", "charger"],
        price_suggestion=PriceSuggestion(min=20, max=25),
    )


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Notion sync timed out. Please try again.", "timeout"),
        ("Could not reach Notion. Check your connection and try again.", "network"),
        ("Could not verify the Notion connection. Please try again.", "tls"),
        ("Notion rate limit reached. Please try again shortly.", "rate_limited"),
        (
            "Notion connection is not authorized. Check the integration permissions.",
            "authorization",
        ),
        (
            "Notion rejected the listing fields. Check the database schema and try again.",
            "schema",
        ),
        ("Could not find the Notion database or page.", "not_found"),
    ],
)
def test_notion_failure_messages_map_to_safe_codes(message, expected):
    assert notion_error_code_from_message(message) == expected


@pytest.mark.parametrize(
    ("reason", "expected_code", "expected_message"),
    [
        (
            ssl.SSLError("certificate verify failed"),
            "tls",
            "Could not verify the Notion connection. Please try again.",
        ),
        (
            TimeoutError("timed out"),
            "timeout",
            "Notion sync timed out. Please try again.",
        ),
        (
            "certificate verify failed",
            "tls",
            "Could not verify the Notion connection. Please try again.",
        ),
        (
            "timed out",
            "timeout",
            "Notion sync timed out. Please try again.",
        ),
        (
            OSError("connection refused"),
            "network",
            "Could not reach Notion. Check your connection and try again.",
        ),
    ],
)
def test_wrapped_url_errors_preserve_specific_failure_categories(
    reason,
    expected_code,
    expected_message,
):
    error = URLError(reason)

    assert notion_error_code(error) == expected_code
    assert user_readable_notion_error(error) == expected_message


def test_build_notion_payload_uses_marketplace_schema():
    payload = build_notion_page_payload(
        analysis=_analysis(),
        listing=_listing(),
        item_id="item-123",
        data_source_id="notion-source",
    )

    assert payload["parent"] == {"type": "data_source_id", "data_source_id": "notion-source"}
    props = payload["properties"]
    assert props["Item Name"]["title"][0]["text"]["content"] == "Spigen ArcPack Wireless Power Bank + Dock"
    assert props["Price"]["number"] == 25
    assert props["Condition"]["select"]["name"] == "Like New"
    assert props["Status"]["select"]["name"] == "Draft"
    assert "Final Sale Price" not in props
    assert props["Platform Posted"]["multi_select"] == [{"name": "Facebook Marketplace"}]
    assert "item-123" in props["Reason for Selling"]["rich_text"][0]["text"]["content"]
    assert props["Buyer Contact"]["rich_text"][0]["text"]["content"] == MANUAL_INPUT_PENDING


def test_build_notion_payload_attaches_photos_property():
    payload = build_notion_page_payload(
        analysis=_analysis(),
        listing=_listing(),
        item_id="item-123",
        data_source_id="notion-source",
        photo_file_upload_ids=["upload-1", "upload-2"],
    )

    assert payload["properties"]["Photos"]["files"] == [
        {"name": "photo-1.jpg", "type": "file_upload", "file_upload": {"id": "upload-1"}},
        {"name": "photo-2.jpg", "type": "file_upload", "file_upload": {"id": "upload-2"}},
    ]


def test_build_notion_payload_supports_legacy_database_parent():
    payload = build_notion_page_payload(
        analysis=_analysis(),
        listing=_listing(),
        item_id="item-123",
        database_id="notion-db",
    )

    assert payload["parent"] == {"database_id": "notion-db"}


def test_build_notion_payload_strips_collection_prefix():
    payload = build_notion_page_payload(
        analysis=_analysis(),
        listing=_listing(),
        item_id="item-123",
        data_source_id="collection://23a0e891-6b4c-80e4-87e4-000b9ca6958c",
    )

    assert payload["parent"] == {
        "type": "data_source_id",
        "data_source_id": "23a0e891-6b4c-80e4-87e4-000b9ca6958c",
    }


def test_unknown_condition_falls_back_to_existing_select_option():
    payload = build_notion_page_payload(
        analysis=_analysis(condition="unknown"),
        listing=_listing(),
        item_id="item-123",
        data_source_id="notion-source",
    )

    assert payload["properties"]["Condition"]["select"]["name"] == "Fair"


@pytest.mark.asyncio
async def test_disabled_service_does_not_call_notion():
    service = NotionService(api_key="", data_source_id="", enabled=False)
    service._post_create_page = MagicMock()

    result = await service.create_listing_entry(
        item_id="item-123",
        analysis=_analysis(),
        listing=_listing(),
    )

    assert result is None
    service._post_create_page.assert_not_called()


@pytest.mark.asyncio
async def test_notion_failure_raises_readable_error(monkeypatch):
    service = NotionService(api_key="secret", data_source_id="source", enabled=True)

    def raise_timeout(payload):
        raise TimeoutError("network timeout")

    monkeypatch.setattr(service, "_post_create_page", raise_timeout)

    with pytest.raises(NotionAPIError, match="timed out"):
        await service.create_listing_entry(
            item_id="item-123",
            analysis=_analysis(),
            listing=_listing(),
        )


@pytest.mark.asyncio
async def test_data_source_lookup_failure_raises_readable_error(monkeypatch):
    service = NotionService(api_key="secret", data_source_id="", database_id="database", enabled=True)

    async def fake_to_thread(fn, *args):
        return fn(*args)

    monkeypatch.setattr(notion_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(
        service,
        "_retrieve_first_data_source_id",
        lambda database_id: (_ for _ in ()).throw(NotionAPIError("HTTP 400: bad database")),
    )

    with pytest.raises(NotionAPIError, match="Notion rejected"):
        await service.create_listing_entry(
            item_id="item-123",
            analysis=_analysis(),
            listing=_listing(),
        )


@pytest.mark.asyncio
async def test_database_id_resolves_to_data_source_before_create(monkeypatch):
    service = NotionService(api_key="secret", data_source_id="", database_id="database", enabled=True)
    created_payload = {}

    async def fake_to_thread(fn, *args):
        return fn(*args)

    def fake_post(payload):
        created_payload.update(payload)
        return {"id": "page-123"}

    monkeypatch.setattr(notion_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(service, "_retrieve_first_data_source_id", lambda database_id: "source-123")
    monkeypatch.setattr(service, "_post_create_page", fake_post)

    result = await service.create_listing_entry(
        item_id="item-123",
        analysis=_analysis(),
        listing=_listing(),
    )

    assert result is not None
    assert result.page_id == "page-123"
    assert created_payload["parent"] == {"type": "data_source_id", "data_source_id": "source-123"}


@pytest.mark.asyncio
async def test_success_returns_page_id(monkeypatch):
    service = NotionService(api_key="secret", data_source_id="source", enabled=True)

    async def fake_to_thread(fn, payload):
        return fn(payload)

    monkeypatch.setattr(notion_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(service, "_post_create_page", lambda payload: {"id": "page-123", "url": "https://notion.so/page-123"})

    result = await service.create_listing_entry(
        item_id="item-123",
        analysis=_analysis(),
        listing=_listing(),
    )

    assert result is not None
    assert result.page_id == "page-123"
    assert result.page_url == "https://notion.so/page-123"


@pytest.mark.asyncio
async def test_ambiguous_create_reconciles_existing_page_without_duplicate(monkeypatch):
    service = NotionService(api_key="secret", data_source_id="source", enabled=True)
    post_create = MagicMock(side_effect=TimeoutError("response timed out"))
    find_existing = MagicMock(
        return_value=notion_module.NotionSyncResult(
            page_id="page-reconciled",
            page_url="https://notion.so/page-reconciled",
        )
    )

    async def fake_to_thread(fn, *args):
        return fn(*args)

    monkeypatch.setattr(notion_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(service, "_post_create_page", post_create)
    monkeypatch.setattr(service, "_find_existing_listing_entry", find_existing)

    with pytest.raises(NotionAPIError, match="timed out"):
        await service.create_listing_entry(
            item_id="item-123",
            analysis=_analysis(),
            listing=_listing(),
        )

    result = await service.create_listing_entry(
        item_id="item-123",
        analysis=_analysis(),
        listing=_listing(),
        reconcile_ambiguous=True,
    )

    assert result is not None
    assert result.page_id == "page-reconciled"
    assert post_create.call_count == 1
    find_existing.assert_called_once_with("item-123", "source", "")


def test_reconciliation_queries_by_embedded_app_item_marker(monkeypatch):
    service = NotionService(api_key="secret", data_source_id="source", enabled=True)
    request_json = MagicMock(
        return_value={
            "results": [
                {
                    "id": "page-123",
                    "url": "https://notion.so/page-123",
                    "in_trash": False,
                }
            ]
        }
    )
    monkeypatch.setattr(service, "_request_json", request_json)

    result = service._find_existing_listing_entry("item-123", "source", "")

    assert result == notion_module.NotionSyncResult(
        page_id="page-123",
        page_url="https://notion.so/page-123",
    )
    request_json.assert_called_once_with(
        notion_module.NOTION_DATA_SOURCE_QUERY_URL.format(data_source_id="source"),
        method="POST",
        payload={
            "filter": {
                "property": "Reason for Selling",
                "rich_text": {"contains": "Created from app item item-123."},
            },
            "page_size": 2,
        },
    )


@pytest.mark.asyncio
async def test_failure_log_uses_safe_category_without_provider_detail(monkeypatch, caplog):
    service = NotionService(api_key="secret", data_source_id="source", enabled=True)

    async def fake_to_thread(fn, *args):
        return fn(*args)

    def reject_create(payload):
        raise NotionAPIError("HTTP 401: private-workspace-name")

    monkeypatch.setattr(notion_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(service, "_post_create_page", reject_create)

    with caplog.at_level("WARNING", logger=notion_module.__name__):
        with pytest.raises(NotionAPIError, match="not authorized"):
            await service.create_listing_entry(
                item_id="item-safe-log",
                analysis=_analysis(),
                listing=_listing(),
            )

    assert "item_id=item-safe-log" in caplog.text
    assert "code=authorization" in caplog.text
    assert "private-workspace-name" not in caplog.text


def test_image_upload_failure_log_redacts_path_and_provider_detail(monkeypatch, caplog):
    service = NotionService(api_key="secret", data_source_id="source", enabled=True)
    monkeypatch.setattr(
        service,
        "_upload_file",
        MagicMock(side_effect=NotionAPIError("HTTP 403: private-upload-url")),
    )

    with caplog.at_level("WARNING", logger=notion_module.__name__):
        result = service._upload_files(
            [ImageAsset(path="private/user/item/photo.jpg", content=b"image")],
            "item-safe-log",
        )

    assert result == []
    assert "item_id=item-safe-log" in caplog.text
    assert "code=authorization" in caplog.text
    assert "private/user/item/photo.jpg" not in caplog.text
    assert "private-upload-url" not in caplog.text


@pytest.mark.asyncio
async def test_existing_page_is_updated_instead_of_duplicated(monkeypatch):
    service = NotionService(api_key="secret", data_source_id="source", enabled=True)
    calls = {}

    async def fake_to_thread(fn, *args):
        return fn(*args)

    def fake_patch(page_id, payload):
        calls["page_id"] = page_id
        calls["payload"] = payload
        return {"id": page_id, "url": "https://notion.so/page-123"}

    post_create = MagicMock()
    monkeypatch.setattr(notion_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(service, "_post_create_page", post_create)
    monkeypatch.setattr(service, "_patch_update_page", fake_patch)

    result = await service.create_listing_entry(
        item_id="item-123",
        analysis=_analysis(),
        listing=_listing(),
        existing_page_id="page-123",
    )

    assert result is not None
    assert result.page_id == "page-123"
    assert calls["page_id"] == "page-123"
    assert "properties" in calls["payload"]
    post_create.assert_not_called()
