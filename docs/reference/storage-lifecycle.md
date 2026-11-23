# Storage lifecycle reference

| State | Path pattern | Meaning |
|---|---|---|
| pending | `pending/{item-or-upload-id}/{index}.jpg` | uploaded but not saved |
| permanent | `{item-id}/{item-id}-{index}.jpg` or replacement variant | associated with a saved item |

New uploads are staged as pending and recorded in the item database. Pending
items remain resumable for seven days by default. Saving promotes them, updates
the UID-scoped item record, clears their pending expiry, and removes old
pending objects. Explicit draft discard removes both the database item and its
pending objects. Replacement uploads use permanent paths or a new pending
group based on the item's current state.

Account deletion removes each pending owned item's complete pending prefix as
well as all recorded paths before deleting database records. This includes
partial idempotent uploads whose item row is still `uploading` with empty image paths.
Supabase prefix contents are listed and removed through the Storage API; local
fallback and in-memory backends implement the same storage contract.

Backend startup and authenticated `/api/items/cleanup` remove expired pending
rows and then their storage objects. The storage age sweep receives the set of
active database-referenced pending paths and preserves them, so it cannot
delete an image that an unexpired mobile operation still needs. A storage
deletion failure is logged for later operator cleanup; the expired database row
is not resurrected.

The stable `Storage` protocol and provider-independent errors live in
`backend/app/services/storage_contract.py`. `SupabaseStorage` and
`InMemoryStorage` are concrete backends in
`backend/app/services/storage_backends.py`. The original
`backend/app/services/storage.py` path remains a compatibility façade for
existing imports.

The Supabase backend supplies an explicitly configured `httpx.Client` to
`supabase-py`. This avoids the deprecated `timeout` and `verify` constructor
arguments that the current `storage3` integration otherwise passes internally.

On mobile, saved listings, Recently Deleted listings, edit drafts, and the
single pending analysis operation are scoped by Firebase UID in AsyncStorage.
The selected camera/picker assets are first copied to
`Paths.document/pending-analysis/{operation-id}/`; the pending operation stores
those durable app-owned URIs, the idempotency key, phase, and server item ID
when known. Analysis completion retains the operation and directory while the
user reviews or manages photos. A successful save first persists server-backed
image references and then clears the recovery record and directory. Explicit
discard from processing or an unsaved review draft, expiry, account cleanup,
and failed setup also clear them. The former global saved-listings key is
migrated at most once: it is unavailable while signed out, permanently claimed
by the first authenticated UID that migrates valid data, copied into that
scope, and then removed. Other accounts on the same device cannot consume the
same legacy listing data.

Errors are classified as `NOT_FOUND`, `FORBIDDEN`, upload/download, promotion,
deletion, or provider failures. Retryable failures map to temporary service
responses rather than missing-image responses.
