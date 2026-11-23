from contextlib import asynccontextmanager

import pytest

from app.models import database

# Keep references to the production functions because the shared test fixture
# replaces database functions with an in-memory implementation.
update_item_analysis = database.update_item_analysis
claim_item_notion_sync = database.claim_item_notion_sync
finish_item_notion_sync = database.finish_item_notion_sync
fail_analysis_job = database.fail_analysis_job


class _FakeConnection:
    def __init__(self, result: str):
        self.result = result
        self.calls: list[tuple] = []

    async def execute(self, *args):
        self.calls.append(args)
        return self.result


class _FetchrowConnection:
    def __init__(self, *rows):
        self.rows = list(rows)
        self.calls: list[tuple] = []

    async def fetchrow(self, *args):
        self.calls.append(args)
        return self.rows.pop(0)


class _FakePool:
    def __init__(self, connection: _FakeConnection):
        self.connection = connection

    @asynccontextmanager
    async def acquire(self):
        yield self.connection


@pytest.mark.asyncio
async def test_update_item_analysis_checks_database_update_result(monkeypatch):
    connection = _FakeConnection("UPDATE 1")
    monkeypatch.setattr(database, "pool", _FakePool(connection))

    await update_item_analysis("item-1", {"category": "chair"}, {"title": "Chair"}, user_id="user-1")

    assert connection.calls[-1][-2:] == ("item-1", "user-1")


@pytest.mark.asyncio
async def test_update_item_analysis_rejects_missing_or_foreign_item(monkeypatch):
    connection = _FakeConnection("UPDATE 0")
    monkeypatch.setattr(database, "pool", _FakePool(connection))

    with pytest.raises(LookupError, match="Item not found for this user"):
        await update_item_analysis("item-1", {}, {}, user_id="other-user")


@pytest.mark.asyncio
async def test_claim_item_notion_sync_uses_bounded_owner_scoped_lease(monkeypatch):
    claimed = {"id": "item-1", "user_id": "user-1", "notion_sync_status": "syncing"}
    connection = _FetchrowConnection(claimed)
    monkeypatch.setattr(database, "pool", _FakePool(connection))

    row, lease_token = await claim_item_notion_sync(
        "item-1",
        "user-1",
        lease_seconds=300,
    )

    assert row == claimed
    assert lease_token
    query, item_id, user_id, token_arg, lease_seconds, _now = connection.calls[0]
    assert "notion_sync_lease_expires_at <= CURRENT_TIMESTAMP" in query
    assert "RETURNING *" in query
    assert (item_id, user_id, token_arg, lease_seconds) == (
        "item-1",
        "user-1",
        lease_token,
        300,
    )


@pytest.mark.asyncio
async def test_claim_item_notion_sync_returns_current_inflight_state(monkeypatch):
    inflight = {"id": "item-1", "user_id": "user-1", "notion_sync_status": "syncing"}
    connection = _FetchrowConnection(None, inflight)
    monkeypatch.setattr(database, "pool", _FakePool(connection))

    row, lease_token = await claim_item_notion_sync(
        "item-1",
        "user-1",
        lease_seconds=300,
    )

    assert row == inflight
    assert lease_token is None
    assert "SELECT * FROM items WHERE id = $1 AND user_id = $2" in connection.calls[1][0]


@pytest.mark.asyncio
async def test_fail_analysis_job_can_release_credential_lease_without_consuming_attempt(monkeypatch):
    retryable = {
        "item_id": "item-1",
        "user_id": "user-1",
        "status": "retryable_failed",
        "attempt_count": 2,
    }
    connection = _FetchrowConnection(retryable)
    monkeypatch.setattr(database, "pool", _FakePool(connection))

    result = await fail_analysis_job(
        "item-1",
        "user-1",
        "lease-token",
        error_code="AI_PROVIDER_CREDENTIAL_INVALID",
        retryable=True,
        consume_attempt=False,
        max_attempts=3,
    )

    assert result == retryable
    query, *args = connection.calls[0]
    assert "WHEN $6 THEN attempt_count" in query
    assert "GREATEST(attempt_count - 1, 0)" in query
    assert args == [
        "item-1",
        "user-1",
        "lease-token",
        "AI_PROVIDER_CREDENTIAL_INVALID",
        True,
        False,
        3,
    ]


@pytest.mark.asyncio
async def test_finish_item_notion_sync_requires_current_lease(monkeypatch):
    connection = _FetchrowConnection(None)
    monkeypatch.setattr(database, "pool", _FakePool(connection))

    with pytest.raises(RuntimeError, match="lease is no longer current"):
        await finish_item_notion_sync(
            "item-1",
            "user-1",
            "stale-token",
            sync_status="synced",
            page_id="page-1",
            succeeded=True,
        )

    query = connection.calls[0][0]
    assert "notion_sync_lease_token = $3" in query
    assert "notion_sync_lease_token = NULL" in query
    assert "notion_create_ambiguous = $10" in query
