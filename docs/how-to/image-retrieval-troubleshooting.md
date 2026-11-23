# Troubleshoot image retrieval

The expected flow is: the mobile client identifies a protected backend image,
obtains a Firebase token, requests `/image/{index}/url`, the backend verifies
ownership and creates a short-lived Supabase signed URL, and the client
renders it or falls back to the authenticated backend image endpoint.

Mobile logs use `[ImageRetrieval]`. Backend logs identify UID, item, image
index, object path, storage backend, returned bytes, and classified failures.

- `401 Unauthorized`: token missing, stale, revoked, or rejected.
- `307 Temporary Redirect`: an older backend may still be running; restart it.
- `404 Image not found`: owned item or image object/index is absent.
- `503 Image temporarily unavailable`: retryable storage/provider failure.
- `no Firebase user available`: signed out or auth state is still restoring.
- `Failed to load` after signing: inspect URL, bucket/object, connectivity, and
  content type.
- `NoSuchKey` for a signed `pending/{item-id}/...` URL after a successful save:
  verify the mobile build invalidates the item's signed-URL cache after the
  pending-to-permanent promotion. Current clients do this automatically.

An Expo Metro tunnel does not automatically tunnel the backend. Test the
backend URL directly from the device, verify `EXPO_PUBLIC_API_URL`, and avoid
stale `loca.lt` URLs.
