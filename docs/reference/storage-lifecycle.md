# Storage lifecycle reference

| State | Path pattern | Meaning |
|---|---|---|
| pending | `pending/{item-or-upload-id}/{index}.jpg` | uploaded but not saved |
| permanent | `{item-id}/{item-id}-{index}.jpg` or replacement variant | associated with a saved item |
| video | `{item-id}/video/{video-id}.{ext}` | the listing's one video (`mp4`, `mov`, `m4v` or `webm`) |
| video frame | `{item-id}/video/{video-id}-frame-{n}.jpg` | up to six frames kept for analysis |

New uploads are staged as pending and recorded in the item database. Pending
items remain resumable for seven days by default. Saving promotes them, updates
the UID-scoped item record, clears their pending expiry, and removes old
pending objects. Explicit draft discard removes both the database item and its
pending objects. Replacement uploads use permanent paths or a new pending
group based on the item's current state.

A listing has at most one video. It is stored directly under the permanent
`{item-id}/video/` prefix (never staged as pending) in the same bucket or local
folder as the photos, and is recorded on the item row (`video_json`, with the
frame paths and the cover frame path). Uploading a second video stores the new
files first and then removes the old video and its frames, so a replaced video
never reuses a URL. A video-only listing also stages the sharpest frame as the
pending cover photo; saving promotes it like any other photo and repoints the
video's cover frame path. Permanent delete of a trashed item, draft discard,
expired-pending cleanup, startup cleanup, `DELETE /api/items/{id}/video`, and
account deletion all remove the video and its frames through
`item_video_paths` / `item_media_paths` in `backend/app/models/database.py`.
Moving an item to Recently Deleted keeps its media until the item is purged.

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
pending analysis operations are scoped by Firebase UID in AsyncStorage.
Unfinished listings are stored as a list under `@pending_analyses`, keyed by
operation ID and returned newest first; the user can have several at once. A
record in the older single slot (`@pending_analysis`) is moved into the list the
first time it is read. The selected camera/picker assets (and the video with its
candidate frames, when there is one) are first copied to
`Paths.document/pending-analysis/{operation-id}/`; each pending operation stores
those durable app-owned URIs, the idempotency key, phase, and server item ID
when known. Analysis completion retains the operation and directory while the
user reviews or manages photos. A successful save first persists server-backed
image references and then clears the recovery record and directory. Explicit
discard from processing, Home, or an unsaved review draft, expiry (expired
operations are dropped when the list is read), account cleanup, and failed
setup also clear the affected operation and its directory. The former global
saved-listings key is migrated at most once: it is unavailable while signed out, permanently claimed
by the first authenticated UID that migrates valid data, copied into that
scope, and then removed. Other accounts on the same device cannot consume the
same legacy listing data.

Device-wide preferences are not scoped by UID and are not cleared by
account cleanup: `@appearance` (`light` or `dark`), `@notification_preferences`
(JSON with `enabled`, `listingReady`, and `needsAttention`), and
`@recently_deleted_retention_days`. Local notifications hold no server state.
Provider API keys stay in Expo SecureStore, not AsyncStorage.

Errors are classified as `NOT_FOUND`, `FORBIDDEN`, upload/download, promotion,
deletion, or provider failures. Retryable failures map to temporary service
responses rather than missing-image responses.
