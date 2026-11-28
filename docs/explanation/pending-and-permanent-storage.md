# Pending and permanent image storage

Uploads happen before the user finishes editing a listing, so they cannot be
treated as permanent immediately. The backend first stores them in a pending
namespace and records that state in the item row.

On save, the backend promotes the objects and updates the row to permanent.
Promotion is designed to be retry-safe, and rollback attempts to restore the
pending state if later save work fails. Startup cleanup removes stale pending
objects abandoned by interrupted sessions.

This lifecycle prevents unfinished drafts from being mistaken for final
listings while limiting orphaned storage.

A listing can include one video. It is stored under the item's own prefix with
its extracted frames, not in the pending image namespace. It is removed with the
item on draft discard, expired-pending cleanup, startup cleanup, permanent
delete and account deletion, using the same item media path helpers as the
photos.

On the phone, every unfinished listing is a separate pending operation, so
several drafts can exist at once. Each keeps its own copied photos, video and
frames until it is saved or discarded. See
[Resumable analysis](resumable-analysis.md).
