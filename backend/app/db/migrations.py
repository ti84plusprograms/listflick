"""Small, ordered PostgreSQL migration runner."""

from collections.abc import Awaitable, Callable

import asyncpg

Migration = Callable[[asyncpg.Connection], Awaitable[None]]

# Stable two-part PostgreSQL advisory-lock key for the ListFlick migration runner.
# Transaction scope guarantees automatic release on commit or rollback.
MIGRATION_LOCK_NAMESPACE = 0x4C495354  # LIST
MIGRATION_LOCK_KEY = 0x464C494B  # FLIK


async def migration_001_create_items(conn: asyncpg.Connection) -> None:
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            image_path TEXT NOT NULL,
            analysis_json TEXT,
            listing_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )


async def migration_002_add_item_lifecycle_columns(conn: asyncpg.Connection) -> None:
    columns = {
        "user_id": "TEXT NOT NULL DEFAULT 'legacy'",
        "image_paths_json": "TEXT",
        "image_storage_state": "TEXT NOT NULL DEFAULT 'permanent'",
        "status": "TEXT NOT NULL DEFAULT 'uploaded'",
        "deleted_at": "TEXT",
        "purge_at": "TEXT",
        "notion_sync_status": "TEXT NOT NULL DEFAULT 'not_synced'",
        "notion_page_id": "TEXT",
        "notion_page_url": "TEXT",
        "notion_last_attempt_at": "TEXT",
        "notion_last_success_at": "TEXT",
        "notion_last_error": "TEXT",
    }
    for name, definition in columns.items():
        await conn.execute(f"ALTER TABLE items ADD COLUMN IF NOT EXISTS {name} {definition}")


async def migration_003_add_item_query_indexes(conn: asyncpg.Connection) -> None:
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_items_user_id ON items (user_id)")
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_items_user_status ON items (user_id, status)")
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_items_purge_at ON items (purge_at)")


async def migration_005_add_resumable_analysis(conn: asyncpg.Connection) -> None:
    columns = {
        "client_request_id": "TEXT",
        "upload_fingerprint": "TEXT",
        "upload_feedback_json": "TEXT",
        "pending_expires_at": "TIMESTAMPTZ",
    }
    for name, definition in columns.items():
        await conn.execute(f"ALTER TABLE items ADD COLUMN IF NOT EXISTS {name} {definition}")

    # Give pre-migration pending uploads the same bounded recovery window as
    # newly created resumable uploads. Rows created after this migration use
    # the configured retention value when they are claimed.
    await conn.execute(
        """
        UPDATE items
        SET pending_expires_at = CURRENT_TIMESTAMP + INTERVAL '168 hours'
        WHERE image_storage_state = 'pending'
          AND pending_expires_at IS NULL
        """
    )

    await conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_items_user_client_request
        ON items (user_id, client_request_id)
        WHERE client_request_id IS NOT NULL
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS analysis_jobs (
            item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            attempt_count INTEGER NOT NULL DEFAULT 0,
            lease_token TEXT,
            lease_expires_at TIMESTAMPTZ,
            last_error_code TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMPTZ,
            CONSTRAINT analysis_jobs_status_check CHECK (
                status IN ('queued', 'processing', 'succeeded', 'retryable_failed', 'terminal_failed')
            )
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_analysis_jobs_user_status ON analysis_jobs (user_id, status)"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_analysis_jobs_lease ON analysis_jobs (status, lease_expires_at)"
    )


async def migration_006_harden_analysis_jobs_access(conn: asyncpg.Connection) -> None:
    await conn.execute("ALTER TABLE analysis_jobs ENABLE ROW LEVEL SECURITY")
    await conn.execute("REVOKE ALL PRIVILEGES ON TABLE analysis_jobs FROM PUBLIC")
    await conn.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE analysis_jobs FROM anon';
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE analysis_jobs FROM authenticated';
            END IF;
        END
        $$
        """
    )


async def migration_007_harden_public_data_api_access(conn: asyncpg.Connection) -> None:
    """Keep app-owned tables behind the server-only PostgreSQL boundary."""
    await conn.execute(
        """
        DO $$
        DECLARE
            app_table_name TEXT;
            data_api_role TEXT;
        BEGIN
            FOREACH app_table_name IN ARRAY ARRAY[
                'items',
                'analysis_jobs',
                'ai_request_usage',
                'schema_migrations'
            ]
            LOOP
                IF to_regclass(format('public.%I', app_table_name)) IS NULL THEN
                    CONTINUE;
                END IF;

                EXECUTE format(
                    'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
                    app_table_name
                );
                EXECUTE format(
                    'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC',
                    app_table_name
                );

                FOREACH data_api_role IN ARRAY ARRAY[
                    'anon',
                    'authenticated',
                    'service_role'
                ]
                LOOP
                    IF EXISTS (
                        SELECT 1 FROM pg_roles WHERE rolname = data_api_role
                    ) THEN
                        EXECUTE format(
                            'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
                            app_table_name,
                            data_api_role
                        );
                    END IF;
                END LOOP;
            END LOOP;

            -- Migrations use the current PostgreSQL role, so harden that
            -- role's defaults against accidental future Data API exposure.
            ALTER DEFAULT PRIVILEGES IN SCHEMA public
                REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public
                REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public
                REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

            FOREACH data_api_role IN ARRAY ARRAY[
                'anon',
                'authenticated',
                'service_role'
            ]
            LOOP
                IF EXISTS (
                    SELECT 1 FROM pg_roles WHERE rolname = data_api_role
                ) THEN
                    EXECUTE format(
                        'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
                        'REVOKE ALL PRIVILEGES ON TABLES FROM %I',
                        data_api_role
                    );
                    EXECUTE format(
                        'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
                        'REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
                        data_api_role
                    );
                    EXECUTE format(
                        'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
                        'REVOKE EXECUTE ON FUNCTIONS FROM %I',
                        data_api_role
                    );
                END IF;
            END LOOP;
        END
        $$
        """
    )


async def migration_008_revoke_global_function_execute_default(
    conn: asyncpg.Connection,
) -> None:
    """Prevent future functions from inheriting EXECUTE for PUBLIC."""
    await conn.execute(
        """
        ALTER DEFAULT PRIVILEGES
            REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC
        """
    )


async def migration_009_add_notion_sync_reason(conn: asyncpg.Connection) -> None:
    """Persist why a Notion synchronization attempt was skipped."""
    await conn.execute(
        "ALTER TABLE items ADD COLUMN IF NOT EXISTS notion_sync_reason TEXT"
    )


async def migration_010_add_notion_sync_lease(conn: asyncpg.Connection) -> None:
    """Serialize Notion writes and remember create results that need reconciliation."""
    columns = {
        "notion_sync_lease_token": "TEXT",
        "notion_sync_lease_expires_at": "TIMESTAMPTZ",
        "notion_create_ambiguous": "BOOLEAN NOT NULL DEFAULT FALSE",
    }
    for name, definition in columns.items():
        await conn.execute(f"ALTER TABLE items ADD COLUMN IF NOT EXISTS {name} {definition}")


async def migration_011_add_item_video(conn: asyncpg.Connection) -> None:
    """One optional video per listing, plus what the last Notion sync did with it."""
    columns = {
        "video_json": "TEXT",
        "notion_media_json": "TEXT",
    }
    for name, definition in columns.items():
        await conn.execute(f"ALTER TABLE items ADD COLUMN IF NOT EXISTS {name} {definition}")


MIGRATIONS: tuple[tuple[int, Migration], ...] = (
    (1, migration_001_create_items),
    (2, migration_002_add_item_lifecycle_columns),
    (3, migration_003_add_item_query_indexes),
    # Version 4 was already applied by the earlier BYOK/rate-limit work in
    # environments that share this database. Never reuse a recorded version,
    # even when that migration is not present in the current checkout.
    (5, migration_005_add_resumable_analysis),
    (6, migration_006_harden_analysis_jobs_access),
    (7, migration_007_harden_public_data_api_access),
    (8, migration_008_revoke_global_function_execute_default),
    (9, migration_009_add_notion_sync_reason),
    (10, migration_010_add_notion_sync_lease),
    (11, migration_011_add_item_video),
)


async def run_migrations(conn: asyncpg.Connection) -> None:
    async with conn.transaction():
        await conn.execute(
            "SELECT pg_advisory_xact_lock($1, $2)",
            MIGRATION_LOCK_NAMESPACE,
            MIGRATION_LOCK_KEY,
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        for version, migration in MIGRATIONS:
            applied = await conn.fetchval(
                "SELECT 1 FROM schema_migrations WHERE version = $1",
                version,
            )
            if applied:
                continue
            await migration(conn)
            await conn.execute("INSERT INTO schema_migrations (version) VALUES ($1)", version)
