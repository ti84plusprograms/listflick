"""Optional Notion sync for generated marketplace listings."""

from __future__ import annotations

import asyncio
import json
import logging
import ssl
from dataclasses import dataclass
from datetime import date
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import certifi

from app.config import settings
from app.schemas.listing import GeneratedListing, VisionAnalysis
from app.services.notion_status import (
    NotionSyncErrorCode,
    notion_error_code_from_message,
    notion_error_message,
)
from app.services.storage import ImageAsset
from app.utils.condition import normalize_condition

logger = logging.getLogger(__name__)

MANUAL_INPUT_PENDING = "manual input pending"
NOTION_CREATE_PAGE_URL = "https://api.notion.com/v1/pages"
NOTION_UPDATE_PAGE_URL = "https://api.notion.com/v1/pages/{page_id}"
NOTION_DATABASE_URL = "https://api.notion.com/v1/databases/{database_id}"
NOTION_DATA_SOURCE_QUERY_URL = "https://api.notion.com/v1/data_sources/{data_source_id}/query"
NOTION_DATABASE_QUERY_URL = "https://api.notion.com/v1/databases/{database_id}/query"
NOTION_FILE_UPLOAD_URL = "https://api.notion.com/v1/file_uploads"


class NotionAPIError(RuntimeError):
    def __init__(self, message: str, *, code: NotionSyncErrorCode | None = None) -> None:
        super().__init__(message)
        self.code: NotionSyncErrorCode = code or notion_error_code_from_message(message) or "unknown"


@dataclass(frozen=True)
class NotionSyncResult:
    page_id: str
    page_url: str | None = None


def _normalize_notion_id(value: str) -> str:
    return value.removeprefix("collection://").strip()


def _plain_text(value: str, max_len: int = 2000) -> dict[str, Any]:
    text = value.strip() if value else MANUAL_INPUT_PENDING
    return {"rich_text": [{"text": {"content": text[:max_len]}}]}


def _title(value: str) -> dict[str, Any]:
    text = value.strip() if value else MANUAL_INPUT_PENDING
    return {"title": [{"text": {"content": text[:2000]}}]}


def _number(value: float | int | None) -> dict[str, Any]:
    return {"number": float(value)} if value is not None else {"number": None}


def _select(value: str) -> dict[str, Any]:
    return {"select": {"name": value}}


def _multi_select(values: list[str]) -> dict[str, Any]:
    return {"multi_select": [{"name": value} for value in values if value]}


def _date(value: date) -> dict[str, Any]:
    return {"date": {"start": value.isoformat()}}


def _condition_for_notion(condition: str) -> str:
    return normalize_condition(condition) or "Fair"


def _app_item_marker(item_id: str) -> str:
    return f"Created from app item {item_id}."


def _asking_price(listing: GeneratedListing) -> float | None:
    price = listing.price_suggestion
    if price.high_ask_price > 0:
        return round(price.high_ask_price, 2)
    if price.max > 0:
        return round(price.max, 2)
    if price.min > 0:
        return round(price.min, 2)
    return None


def user_readable_notion_error(exc: BaseException) -> str:
    return notion_error_message(notion_error_code(exc))


def _url_error_code(exc: URLError) -> NotionSyncErrorCode:
    reason = exc.reason
    if isinstance(reason, ssl.SSLError):
        return "tls"
    if isinstance(reason, TimeoutError):
        return "timeout"
    wrapped_code = notion_error_code_from_message(str(reason))
    if wrapped_code in {"tls", "timeout"}:
        return wrapped_code
    return "network"


def notion_error_code(exc: BaseException) -> NotionSyncErrorCode:
    if isinstance(exc, NotionAPIError):
        return exc.code
    if isinstance(exc, TimeoutError):
        return "timeout"
    if isinstance(exc, HTTPError):
        return notion_error_code_from_message(f"HTTP {exc.code}") or "unknown"
    if isinstance(exc, URLError):
        return _url_error_code(exc)
    if isinstance(exc, ssl.SSLError):
        return "tls"
    return "unknown"


def build_notion_page_payload(
    *,
    analysis: VisionAnalysis,
    listing: GeneratedListing,
    item_id: str,
    data_source_id: str = "",
    database_id: str = "",
    photo_file_upload_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Build a Notion Create Page payload matching the Marketplace Listings schema."""
    if data_source_id:
        parent = {"type": "data_source_id", "data_source_id": _normalize_notion_id(data_source_id)}
    elif database_id:
        parent = {"database_id": _normalize_notion_id(database_id)}
    else:
        raise ValueError("A Notion data source ID or database ID is required")

    title = listing.title or analysis.item_name or MANUAL_INPUT_PENDING
    description = listing.description or MANUAL_INPUT_PENDING
    internal_note = (
        f"{MANUAL_INPUT_PENDING}. {_app_item_marker(item_id)} "
        f"Review photo, category, price, and posting details before publishing."
    )
    properties = {
        "Item Name": _title(title),
        "Condition": _select(_condition_for_notion(analysis.condition)),
        "Description": _plain_text(description),
        "Reason for Selling": _plain_text(internal_note),
        "Date Listed": _date(date.today()),
        "Status": _select("Draft"),
        "Buyer Contact": _plain_text(MANUAL_INPUT_PENDING),
        "Platform Posted": _multi_select(["Facebook Marketplace"]),
    }

    price = _asking_price(listing)
    if price is not None:
        properties["Price"] = _number(price)
    if photo_file_upload_ids:
        properties["Photos"] = {
            "files": [
                {
                    "name": f"photo-{index + 1}.jpg",
                    "type": "file_upload",
                    "file_upload": {"id": file_upload_id},
                }
                for index, file_upload_id in enumerate(photo_file_upload_ids)
            ]
        }

    return {
        "parent": parent,
        "properties": properties,
    }


class NotionService:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        data_source_id: str | None = None,
        database_id: str | None = None,
        api_version: str | None = None,
        enabled: bool | None = None,
    ) -> None:
        self.api_key = settings.notion_api_key if api_key is None else api_key
        self.data_source_id = settings.notion_data_source_id if data_source_id is None else data_source_id
        self.database_id = settings.notion_database_id if database_id is None else database_id
        self.api_version = settings.notion_api_version if api_version is None else api_version
        self.enabled = settings.notion_create_entries if enabled is None else enabled

    @property
    def is_configured(self) -> bool:
        return bool(self.enabled and self.api_key and (self.data_source_id or self.database_id))

    async def create_listing_entry(
        self,
        *,
        item_id: str,
        analysis: VisionAnalysis,
        listing: GeneratedListing,
        image_assets: list[ImageAsset] | None = None,
        existing_page_id: str | None = None,
        reconcile_ambiguous: bool = False,
    ) -> NotionSyncResult | None:
        """Create or update a Notion row when configured."""
        if not self.is_configured:
            return None

        try:
            data_source_id = self.data_source_id
            if not data_source_id and self.database_id and self.api_version >= "2025-09-03":
                data_source_id = await asyncio.to_thread(
                    self._retrieve_first_data_source_id,
                    _normalize_notion_id(self.database_id),
                )
            if not existing_page_id and reconcile_ambiguous:
                reconciled = await asyncio.to_thread(
                    self._find_existing_listing_entry,
                    item_id,
                    data_source_id,
                    "" if data_source_id else self.database_id,
                )
                if reconciled is not None:
                    logger.info("Notion create reconciled item_id=%s", item_id)
                    return reconciled
            photo_file_upload_ids = []
            if image_assets:
                photo_file_upload_ids = await asyncio.to_thread(
                    self._upload_files,
                    image_assets,
                    item_id,
                )

            payload = build_notion_page_payload(
                analysis=analysis,
                listing=listing,
                item_id=item_id,
                data_source_id=data_source_id,
                database_id="" if data_source_id else self.database_id,
                photo_file_upload_ids=photo_file_upload_ids,
            )
            if existing_page_id:
                response = await asyncio.to_thread(self._patch_update_page, existing_page_id, payload)
            else:
                response = await asyncio.to_thread(self._post_create_page, payload)
        except (HTTPError, NotionAPIError, URLError, TimeoutError, OSError, ValueError, ssl.SSLError) as exc:
            code = notion_error_code(exc)
            message = user_readable_notion_error(exc)
            logger.warning("Notion sync failed item_id=%s code=%s message=%s", item_id, code, message)
            raise NotionAPIError(message, code=code) from exc

        page_id = response.get("id")
        page_url = response.get("url")
        if not isinstance(page_id, str):
            raise NotionAPIError(notion_error_message("unknown"), code="unknown")
        return NotionSyncResult(
            page_id=page_id,
            page_url=page_url if isinstance(page_url, str) else None,
        )

    def _post_create_page(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request_json(NOTION_CREATE_PAGE_URL, method="POST", payload=payload)

    def _patch_update_page(self, page_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request_json(
            NOTION_UPDATE_PAGE_URL.format(page_id=_normalize_notion_id(page_id)),
            method="PATCH",
            payload={"properties": payload["properties"]},
        )

    def _upload_files(self, image_assets: list[ImageAsset], item_id: str) -> list[str]:
        upload_ids: list[str] = []
        for asset in image_assets:
            try:
                upload_id = self._upload_file(asset)
            except (OSError, NotionAPIError, HTTPError, URLError, TimeoutError, ValueError) as exc:
                logger.warning(
                    "Notion image upload failed item_id=%s code=%s",
                    item_id,
                    notion_error_code(exc),
                )
                continue
            if upload_id:
                upload_ids.append(upload_id)
        return upload_ids

    def _upload_file(self, asset: ImageAsset) -> str:
        content_type = asset.content_type
        created = self._request_json(
            NOTION_FILE_UPLOAD_URL,
            method="POST",
            payload={"mode": "single_part", "filename": asset.filename, "content_type": content_type},
        )
        upload_id = created.get("id")
        upload_url = created.get("upload_url") or (
            f"{NOTION_FILE_UPLOAD_URL}/{upload_id}/send" if isinstance(upload_id, str) else ""
        )
        if not isinstance(upload_id, str) or not isinstance(upload_url, str) or not upload_url:
            raise ValueError("Unexpected Notion file upload response")

        sent = self._request_multipart_file(upload_url, asset, content_type)
        if sent.get("status") != "uploaded":
            raise ValueError(f"Notion file upload did not complete: {sent}")
        return upload_id

    def _retrieve_first_data_source_id(self, database_id: str) -> str:
        data = self._request_json(
            NOTION_DATABASE_URL.format(database_id=database_id),
            method="GET",
            payload=None,
        )
        data_sources = data.get("data_sources")
        if not isinstance(data_sources, list) or not data_sources:
            return ""

        first = data_sources[0]
        if not isinstance(first, dict):
            return ""

        data_source_id = first.get("id")
        return data_source_id if isinstance(data_source_id, str) else ""

    def _find_existing_listing_entry(
        self,
        item_id: str,
        data_source_id: str,
        database_id: str,
    ) -> NotionSyncResult | None:
        if data_source_id:
            url = NOTION_DATA_SOURCE_QUERY_URL.format(
                data_source_id=_normalize_notion_id(data_source_id)
            )
        elif database_id:
            url = NOTION_DATABASE_QUERY_URL.format(
                database_id=_normalize_notion_id(database_id)
            )
        else:
            return None

        response = self._request_json(
            url,
            method="POST",
            payload={
                "filter": {
                    "property": "Reason for Selling",
                    "rich_text": {"contains": _app_item_marker(item_id)},
                },
                "page_size": 2,
            },
        )
        results = response.get("results")
        if not isinstance(results, list):
            raise ValueError("Unexpected Notion query response")

        matches = [
            result
            for result in results
            if isinstance(result, dict)
            and isinstance(result.get("id"), str)
            and result.get("in_trash") is not True
        ]
        if not matches:
            return None
        if len(matches) > 1:
            logger.warning("Multiple Notion pages matched item_id=%s", item_id)
        page = matches[0]
        page_url = page.get("url")
        return NotionSyncResult(
            page_id=page["id"],
            page_url=page_url if isinstance(page_url, str) else None,
        )

    def _request_json(
        self,
        url: str,
        *,
        method: str,
        payload: dict[str, Any] | None,
    ) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(
            url,
            data=body,
            method=method,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Notion-Version": self.api_version,
            },
        )
        ssl_context = ssl.create_default_context(cafile=certifi.where())

        try:
            with urlopen(request, timeout=15, context=ssl_context) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise NotionAPIError(f"HTTP {exc.code}: {detail}") from exc

        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("Unexpected Notion response")
        return data

    def _request_multipart_file(self, url: str, asset: ImageAsset, content_type: str) -> dict[str, Any]:
        boundary = "----listing-assistant-boundary"
        file_bytes = asset.content
        filename = asset.filename
        body = b"".join(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
                f"Content-Type: {content_type}\r\n\r\n".encode(),
                file_bytes,
                b"\r\n",
                f"--{boundary}--\r\n".encode(),
            ]
        )
        request = Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Notion-Version": self.api_version,
            },
        )
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        try:
            with urlopen(request, timeout=30, context=ssl_context) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise NotionAPIError(f"HTTP {exc.code}: {detail}") from exc

        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("Unexpected Notion response")
        return data


notion_service = NotionService()
