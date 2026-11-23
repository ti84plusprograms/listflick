# Notion synchronization modes

Notion is optional. `NOTION_CREATE_ENTRIES=false` keeps local and shared
testing focused on listing persistence without external Notion writes.

When backend Notion creation is enabled and credentials identify a data source
or database, saving can create or update a Notion page. A development-only
client override can disable a request temporarily when
`NOTION_ALLOW_CLIENT_OVERRIDE=true`; it cannot enable Notion when the backend
has disabled it.

Keep the override disabled in preview and production unless there is a
deliberate operational reason to expose it.

`GET /health` reports a `notion_capability` object without returning secrets or
destination identifiers. Its `reason` distinguishes a backend deployment that
has disabled creation from one that enabled creation but is missing a credential
or destination. The legacy `notion_configured` and
`notion_client_override_allowed` booleans remain for older clients.

In development Settings, **Notion Request Override** reflects this backend
capability. The switch is interactive only when the backend is configured and
explicitly permits the client override. A locally saved `true` value cannot make
an unconfigured deployment appear connected. Development builds keep the row
visible but disabled when the backend is disabled or missing configuration, so
the safe capability reason remains visible.

Until the user-facing Notion integration is complete, mobile Notion controls,
status, retry/open actions, and save messaging are shown only in development
builds after backend capability is known. Preview and production builds keep
the normal inventory-only experience even when the backend integration is
configured.

Listing persistence and Notion synchronization are separate outcomes. Save and
retry responses include the durable Notion status plus a safe `reason` or
`error_code`. A Notion failure does not roll back the saved listing. Review
shows whether sync was skipped, needs a retry, has a configuration problem, or
completed, and an existing Notion page can still be opened while future sync
requests are paused.

## Write serialization and ambiguous creates

Before calling Notion, the backend claims a bounded item-scoped PostgreSQL
lease. An overlapping save or retry sees `syncing` and does not issue another
provider request. If the active process disappears, the lease expires and a
later retry can claim the item. `NOTION_SYNC_LEASE_SECONDS` controls this bound.

The Notion payload already embeds a stable `Created from app item <item-id>.`
marker in **Reason for Selling**. When a create request has an ambiguous
network, TLS, or timeout result, the backend persists that fact. The next retry
queries the configured data source for the marker before creating anything. A
match restores the page ID and URL to the item record; no duplicate page or
duplicate image upload is created. This reconciliation does not require an
additional property in the Notion schema.
