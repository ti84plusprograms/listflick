import asyncio

import pytest

from app.db.migrations import (
    MIGRATION_LOCK_KEY,
    MIGRATION_LOCK_NAMESPACE,
    run_migrations,
)


class FakeTransaction:
    def __init__(self, connection: "FakeConnection") -> None:
        self.connection = connection

    async def __aenter__(self) -> None:
        self.connection.commands.append("BEGIN")

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        self.connection.commands.append("ROLLBACK" if exc_type else "COMMIT")
        if self.connection.holds_migration_lock:
            self.connection.migration_lock.release()
            self.connection.holds_migration_lock = False


class FakeConnection:
    def __init__(
        self,
        applied: set[int] | None = None,
        *,
        migration_lock: asyncio.Lock | None = None,
    ) -> None:
        self.applied = applied if applied is not None else set()
        self.commands: list[str] = []
        self.migration_lock = migration_lock or asyncio.Lock()
        self.holds_migration_lock = False

    def transaction(self) -> FakeTransaction:
        return FakeTransaction(self)

    async def execute(self, query: str, *args: object) -> None:
        self.commands.append(query)
        if query == "SELECT pg_advisory_xact_lock($1, $2)":
            assert args == (MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_KEY)
            await self.migration_lock.acquire()
            self.holds_migration_lock = True
        if query.startswith("INSERT INTO schema_migrations"):
            version = int(args[0])
            if version in self.applied:
                raise RuntimeError(f"duplicate migration version {version}")
            self.applied.add(version)

    async def fetchval(self, _query: str, version: int) -> int | None:
        await asyncio.sleep(0)
        return 1 if version in self.applied else None


@pytest.mark.asyncio
async def test_migrations_apply_once_in_order() -> None:
    connection = FakeConnection()

    await run_migrations(connection)
    first_run_commands = len(connection.commands)

    assert connection.applied == {1, 2, 3, 5, 6, 7, 8, 9, 10, 11}
    assert connection.commands[:2] == [
        "BEGIN",
        "SELECT pg_advisory_xact_lock($1, $2)",
    ]
    assert "CREATE TABLE IF NOT EXISTS schema_migrations" in connection.commands[2]
    assert connection.commands.index("CREATE INDEX IF NOT EXISTS idx_items_user_id ON items (user_id)") < len(connection.commands)
    assert any("CREATE TABLE IF NOT EXISTS analysis_jobs" in command for command in connection.commands)
    assert any("idx_items_user_client_request" in command for command in connection.commands)
    assert any("SET pending_expires_at" in command for command in connection.commands)
    assert any("ENABLE ROW LEVEL SECURITY" in command for command in connection.commands)
    assert any("FROM PUBLIC" in command for command in connection.commands)
    security_command = next(
        command for command in connection.commands if "app_table_name TEXT" in command
    )
    for table_name in (
        "items",
        "analysis_jobs",
        "ai_request_usage",
        "schema_migrations",
    ):
        assert f"'{table_name}'" in security_command
    assert "'anon'" in security_command
    assert "'authenticated'" in security_command
    assert "'service_role'" in security_command
    assert "ALTER DEFAULT PRIVILEGES IN SCHEMA public" in security_command
    assert "ON TABLES" in security_command
    assert "ON SEQUENCES" in security_command
    assert "ON FUNCTIONS" in security_command
    assert "CREATE POLICY" not in security_command
    assert any("notion_sync_reason" in command for command in connection.commands)
    assert any("notion_sync_lease_token" in command for command in connection.commands)
    assert any("notion_sync_lease_expires_at" in command for command in connection.commands)
    assert any("notion_create_ambiguous" in command for command in connection.commands)

    await run_migrations(connection)

    assert len(connection.commands) == first_run_commands + 4


@pytest.mark.asyncio
async def test_concurrent_migration_runners_serialize_version_claims() -> None:
    applied: set[int] = set()
    migration_lock = asyncio.Lock()
    first = FakeConnection(applied, migration_lock=migration_lock)
    second = FakeConnection(applied, migration_lock=migration_lock)

    await asyncio.gather(run_migrations(first), run_migrations(second))

    assert applied == {1, 2, 3, 5, 6, 7, 8, 9, 10, 11}
    inserts = [
        command
        for connection in (first, second)
        for command in connection.commands
        if command.startswith("INSERT INTO schema_migrations")
    ]
    assert len(inserts) == len(applied)


@pytest.mark.asyncio
async def test_resumable_migration_runs_after_historical_version_four() -> None:
    connection = FakeConnection(applied={1, 2, 3, 4})

    await run_migrations(connection)

    assert connection.applied == {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}
    assert any("pending_expires_at" in command for command in connection.commands)
    assert any("CREATE TABLE IF NOT EXISTS analysis_jobs" in command for command in connection.commands)
    assert any("FROM authenticated" in command for command in connection.commands)


@pytest.mark.asyncio
async def test_security_migration_skips_historical_optional_tables_safely() -> None:
    connection = FakeConnection(applied={1, 2, 3, 4, 5, 6})

    await run_migrations(connection)

    assert connection.applied == {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}
    security_command = next(
        command for command in connection.commands if "app_table_name TEXT" in command
    )
    assert "to_regclass" in security_command
    assert "CONTINUE" in security_command


@pytest.mark.asyncio
async def test_function_default_execute_revoke_is_global() -> None:
    connection = FakeConnection(applied={1, 2, 3, 4, 5, 6, 7})

    await run_migrations(connection)

    assert connection.applied == {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}
    function_default_command = next(
        command
        for command in connection.commands
        if "REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC" in command
    )
    assert "ALTER DEFAULT PRIVILEGES" in function_default_command
    assert "IN SCHEMA" not in function_default_command
