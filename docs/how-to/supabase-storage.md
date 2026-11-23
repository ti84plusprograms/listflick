# Configure Supabase Storage

1. Create a private bucket named `images`, or choose another name for
   `SUPABASE_STORAGE_BUCKET`.
2. Configure the backend only with `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`.
3. Never place the service-role key in `mobile/.env`, EAS public environment
   variables, or the client bundle.
4. Start the backend and inspect `/health` plus storage startup logs.

The backend uses the service-role client to upload, read, delete, and create
short-lived signed URLs. The mobile app receives either a signed URL or an
authenticated backend image response; it does not access Supabase directly.

Idempotent upload recovery replaces deterministic `pending/{item-id}/` objects
only after the backend verifies the user-scoped operation key and normalized
image fingerprint. Supabase Storage upsert requires object `INSERT`, `SELECT`,
and `UPDATE` permissions. The configured server-only service-role credential
provides this boundary; if it is replaced by a restricted server credential,
grant all three operations without exposing that credential to mobile.

If Supabase is not configured, local files are stored below `backend/uploads/`.
That fallback is not durable on Render because the filesystem is ephemeral.
Storage paths reject absolute paths, parent traversal, and backslashes.
Uploads are staged below `pending/`; saving promotes them into an item-specific
permanent path. Stale pending objects are cleaned during backend startup.
