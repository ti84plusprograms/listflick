import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api import account as account_api
from app.main import app
from app.services.account_deletion import delete_user_data
from app.services.storage import InMemoryStorage
from app.services.storage_contract import StorageError, StorageErrorCode


def test_account_route_requires_authentication():
    response = TestClient(app).delete("/api/account")

    assert response.status_code == 401
    assert response.json()["detail"] == "Authentication required"


@pytest.mark.asyncio
async def test_delete_user_data_removes_pending_prefixes_and_unique_image_paths_before_records():
    records = [
        {
            "id": "item-1",
            "image_storage_state": "pending",
            "image_path": "item-1/one.jpg",
            "image_paths_json": json.dumps(["item-1/one.jpg", "item-1/two.jpg"]),
        },
        {
            "id": "item-2",
            "image_storage_state": "permanent",
            "image_path": "item-2/one.jpg",
            "image_paths_json": json.dumps(["item-1/two.jpg", "item-2/one.jpg"]),
        },
    ]
    storage = InMemoryStorage()
    call_order: list[str] = []
    deleted_users: list[str] = []

    async def delete_items(uid: str) -> None:
        call_order.append("database")
        deleted_users.append(uid)

    original_delete = storage.delete
    original_delete_pending_item = storage.delete_pending_item

    async def tracking_delete(paths: list[str]) -> None:
        call_order.append("storage")
        await original_delete(paths)

    storage.delete = tracking_delete

    async def tracking_delete_pending_item(item_id: str) -> None:
        call_order.append(f"pending:{item_id}")
        await original_delete_pending_item(item_id)

    storage.delete_pending_item = tracking_delete_pending_item

    deleted_count = await delete_user_data(
        "user-1",
        list_items=lambda uid: _return(records),
        delete_items=delete_items,
        storage=storage,
    )

    assert deleted_count == 2
    assert storage.deleted == ["item-1/one.jpg", "item-1/two.jpg", "item-2/one.jpg"]
    assert deleted_users == ["user-1"]
    assert call_order[-1] == "database"
    assert "pending:item-2" not in call_order
    assert call_order.index("pending:item-1") < call_order.index("database")


@pytest.mark.asyncio
async def test_delete_user_data_removes_partial_uploads_missing_from_item_paths():
    records = [
        {
            "id": "item-1",
            "image_path": "",
            "image_paths_json": "[]",
            "image_storage_state": "pending",
            "status": "uploading",
        }
    ]
    storage = InMemoryStorage()
    storage.objects.update(
        {
            "pending/item-1/1.jpg": b"first",
            "pending/item-1/2.jpg": b"second",
            "pending/item-2/1.jpg": b"other-user",
        }
    )
    deleted_users: list[str] = []

    await delete_user_data(
        "user-1",
        list_items=lambda uid: _return(records),
        delete_items=lambda uid: _record_user(deleted_users, uid),
        storage=storage,
    )

    assert "pending/item-1/1.jpg" not in storage.objects
    assert "pending/item-1/2.jpg" not in storage.objects
    assert storage.objects["pending/item-2/1.jpg"] == b"other-user"
    assert deleted_users == ["user-1"]


@pytest.mark.asyncio
async def test_delete_account_removes_server_data_and_firebase_user(monkeypatch):
    storage = InMemoryStorage()
    deleted_users: list[str] = []
    firebase_users: list[str] = []

    async def list_user_items(uid: str) -> list[dict]:
        return [{"id": "item-1", "image_path": "user-1/image.jpg", "image_paths_json": None}]

    async def delete_user_items(uid: str) -> None:
        deleted_users.append(uid)

    def delete_firebase_user(uid: str) -> None:
        firebase_users.append(uid)

    monkeypatch.setattr(account_api, "list_items", list_user_items)
    monkeypatch.setattr(account_api, "delete_items_for_user", delete_user_items)
    monkeypatch.setattr(account_api, "storage_service", storage)
    monkeypatch.setattr(account_api.firebase_auth, "delete_user", delete_firebase_user)

    result = await account_api.delete_account(uid="user-1")

    assert result == {"deleted": True, "deleted_item_count": 1}
    assert storage.deleted == ["user-1/image.jpg"]
    assert deleted_users == ["user-1"]
    assert firebase_users == ["user-1"]


@pytest.mark.asyncio
async def test_delete_account_stops_before_firebase_on_storage_failure(monkeypatch):
    class FailingStorage(InMemoryStorage):
        async def delete(self, paths: list[str]) -> None:
            raise StorageError("storage unavailable", StorageErrorCode.PROVIDER_UNAVAILABLE)

    deleted_users: list[str] = []
    firebase_users: list[str] = []

    async def list_user_items(uid: str) -> list[dict]:
        return [{"id": "item-1", "image_path": "user-1/image.jpg", "image_paths_json": None}]

    async def delete_user_items(uid: str) -> None:
        deleted_users.append(uid)

    def delete_firebase_user(uid: str) -> None:
        firebase_users.append(uid)

    monkeypatch.setattr(account_api, "list_items", list_user_items)
    monkeypatch.setattr(account_api, "delete_items_for_user", delete_user_items)
    monkeypatch.setattr(account_api, "storage_service", FailingStorage())
    monkeypatch.setattr(account_api.firebase_auth, "delete_user", delete_firebase_user)

    with pytest.raises(HTTPException) as raised:
        await account_api.delete_account(uid="user-1")

    assert raised.value.status_code == 502
    assert deleted_users == []
    assert firebase_users == []


@pytest.mark.asyncio
async def test_delete_account_stops_before_firebase_on_database_failure_after_storage_cleanup(monkeypatch):
    storage = InMemoryStorage()
    firebase_users: list[str] = []

    async def list_user_items(uid: str) -> list[dict]:
        return [{"id": "item-1", "image_path": "user-1/image.jpg", "image_paths_json": None}]

    async def delete_user_items(uid: str) -> None:
        raise RuntimeError("database unavailable")

    def delete_firebase_user(uid: str) -> None:
        firebase_users.append(uid)

    monkeypatch.setattr(account_api, "list_items", list_user_items)
    monkeypatch.setattr(account_api, "delete_items_for_user", delete_user_items)
    monkeypatch.setattr(account_api, "storage_service", storage)
    monkeypatch.setattr(account_api.firebase_auth, "delete_user", delete_firebase_user)

    with pytest.raises(HTTPException) as raised:
        await account_api.delete_account(uid="user-1")

    assert raised.value.status_code == 500
    assert storage.deleted == ["user-1/image.jpg"]
    assert firebase_users == []


async def _return(value):
    return value


async def _record_user(target: list[str], uid: str) -> None:
    target.append(uid)
