"""Orchestration for deleting data owned by one authenticated user."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from app.models.database import item_image_paths
from app.services.storage_contract import Storage

ListItems = Callable[[str], Awaitable[list[dict[str, Any]]]]
DeleteItems = Callable[[str], Awaitable[None]]


async def delete_user_data(
    uid: str,
    *,
    list_items: ListItems,
    delete_items: DeleteItems,
    storage: Storage,
) -> int:
    """Remove a user's images and listing records, returning the item count."""
    items = await list_items(uid)
    pending_item_ids = list(
        dict.fromkeys(
            str(item["id"])
            for item in items
            if item.get("image_storage_state") == "pending"
            or item.get("status") == "uploading"
        )
    )
    image_paths = list(
        dict.fromkeys(
            path
            for item in items
            for path in item_image_paths(item)
            if path
        )
    )
    # Remove storage while item IDs and paths remain durable. This makes a
    # failed deletion retryable and also covers interrupted uploads whose
    # deterministic pending prefix was never written back to the item row.
    for item_id in pending_item_ids:
        await storage.delete_pending_item(item_id)
    await storage.delete(image_paths)
    await delete_items(uid)
    return len(items)
