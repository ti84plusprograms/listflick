# Account lifecycle reference

## Account deletion

`DELETE /api/account` requires a Firebase bearer token and deletes the
authenticated user's server-side listing data, stored image and video objects, and
associated analysis jobs, then deletes the Firebase Authentication account.
The route never accepts a UID from the
client; ownership comes from the verified token.

Storage cleanup runs before database and Firebase deletion. It removes the
image, video, and video-frame paths recorded on each item and the deterministic
`pending/{item-id}/` prefix for pending/uploading items. The prefix cleanup
covers an interrupted idempotent upload that stored one or more objects before
its paths were written to the item row. If Storage cleanup fails, the item
records and Firebase account remain available so the same authenticated
deletion can be retried.

The mobile client then clears that UID's local listings, drafts, pending
analysis operations (and their local files), profile, and Recently Deleted
records before signing out.

Optional Notion pages are external copies. They are not automatically deleted
because the current integration is shared rather than user-authorized.
