# Set up the backend

Run `make install-backend`, then copy `backend/.env.example` to
`backend/.env`. Activate the environment for direct commands:

```bash
source backend/.venv/bin/activate
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Required operational inputs are a PostgreSQL `DATABASE_URL` and Firebase Admin
credentials. In the default BYOK mode, provider keys come from authenticated
mobile requests and are never persisted by the backend. A server-side AI key
is required only when the self-hoster explicitly enables
`ALLOW_SERVER_AI_KEY_FALLBACK`; that key and its usage costs belong to the
self-hoster. Supported providers are Gemini (`GEMINI_API_KEY`), Groq
(`GROQ_API_KEY`) and Claude (`ANTHROPIC_API_KEY`), selected with `AI_PROVIDER`
(`gemini`, `groq` or `claude`). Video uploads are limited by
`MAX_VIDEO_UPLOAD_MB` (default 100). Supabase credentials are required for durable production image
storage. Without Supabase credentials, the storage abstraction falls back to
`backend/uploads/`, which is suitable only for local development.

The backend runs the ordered PostgreSQL migrations in
`backend/app/db/migrations.py` during startup. A `schema_migrations` table
records applied versions. Do not edit a deployed database manually; add a new
numbered migration for schema changes. Migration numbers are global to every
branch and deployment that shares a database. Once a version has been recorded
in any shared environment, never assign different DDL to that number; use the
next unused version even if the earlier migration is absent from the current
checkout.

Startup wraps the migration batch in one PostgreSQL transaction and acquires a
transaction-scoped advisory lock. Overlapping Render instances therefore wait
for the active runner, recheck recorded versions, and do not apply or record the
same migration twice.

The database is server-only. Mobile clients authenticate to FastAPI with
Firebase and never query the Supabase Data API directly. Every app-owned table
in the exposed `public` schema therefore has RLS enabled with no client
policies, and all privileges are revoked from `PUBLIC`, `anon`,
`authenticated`, and `service_role`. The migration role used by `DATABASE_URL`
owns the tables and performs backend operations; production currently uses a
Supabase PostgreSQL role with `BYPASSRLS`. Migration 7 revokes that role's
default public-schema table and sequence grants. Migration 8 separately
revokes the global default `PUBLIC` function execution grant, because a
schema-scoped revoke cannot override PostgreSQL's global default. Future
functions therefore require an explicit `GRANT EXECUTE` to become callable by
a client role. Any future direct-client database feature requires an explicit
architecture change, least-privilege grants, ownership policies, and allow/deny
tests in the same migration.

See [Harden Supabase access](supabase-security.md) for the production audit and
verification procedure.

Check startup configuration with `curl http://localhost:8000/health`. Do not
expose `FIREBASE_SERVICE_ACCOUNT_JSON` or `SUPABASE_SERVICE_ROLE_KEY` to the
mobile application.
