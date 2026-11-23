# Image retrieval flow

The mobile listing data contains backend image paths. `AuthenticatedImage`
recognizes protected API URLs and waits for a Firebase token before making a
request, avoiding an intentional unauthenticated image load.

The signed-URL path is preferred because Supabase serves the bytes directly.
The client caches signed URLs in memory, deduplicates concurrent requests, and
refreshes the Firebase token once after an auth rejection. If signing fails,
the client sends the Firebase token to the backend byte endpoint.

Saving a new listing promotes its images from pending to permanent object
paths. After that save succeeds, the client invalidates every cached signed URL
for the item, including the base `/image` route and indexed `/image/{index}`
routes. The inventory view therefore resolves fresh URLs for the permanent
objects instead of reusing valid-but-stale URLs for deleted pending objects.

This preserves private-bucket access while reducing repeated backend byte
transfers. Metro tunnel status and backend tunnel status must be diagnosed
separately.

**Manage Photos** uses the same `AuthenticatedImage` boundary for local,
content, protected backend, and signed remote image references. Each grid tile
owns its loading and error state, while the viewer maintains an independent
state for its contain-mode images. Loading ends as soon as `AuthenticatedImage`
attaches a renderable source; native load and guarded load-end callbacks remain
fallbacks, and load-end does not overwrite an error callback. A stale loading
state never blocks opening a tile. The loading indicator remains transparent so
already-rendered pixels are never hidden behind a placeholder. Retrying a
failed protected image clears only that image's signed-URL cache entry before
resolving it again; other listing images remain available.
Authentication-resolution failures propagate through the same image error
callback as native decode or network failures.

Tapping a loaded grid image opens a native page-sheet viewer. The sheet reads
the current listing workspace directly, pages horizontally, presents the whole
image in contain mode, and does not serialize image URLs or tokens into
navigation state. On iOS, users can dismiss the native sheet with a downward
swipe; the visible close control and platform back action remain available.
Closing preserves unsaved photo order and edits.
