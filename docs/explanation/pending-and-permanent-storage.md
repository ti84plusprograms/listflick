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
