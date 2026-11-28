# Listing image downloads reference

This document describes the mobile listing image download and camera-roll export architecture, supported URI schemes, authenticated URL resolution, temporary file lifecycle, error categorization, and safe retry behavior.

## Overview

Users can export listing photos to their native device photo library (Camera Roll on iOS, Gallery/Google Photos on Android) from the Review screen overflow menu (**Save Photos to Device**).

When the listing has a video, the same action is **Save Photos & Video**: `saveListingMediaToLibrary` saves the photos in listing order (photo 1, the cover, first) and then the video, with the same one-tap `MediaLibrary.saveToLibraryAsync` path. The permission request adds `video` only in that case. A backend video (`/api/items/<id>/video/<video_id>`) resolves through the same signed-URL flow and is saved from a temporary `.mp4`/`.mov` file so the library treats it as a video. A denied permission offers **Open Settings** when the system will not ask again.

The download workflow is managed by `mobile/services/imageDownload.ts` and `mobile/services/imageRetrieval.ts`, called consistently from `mobile/app/review.tsx` and `mobile/hooks/useReviewListing.ts`.

## Supported URI schemes

The service accepts heterogeneous batches containing any mix of the following schemes:

| Scheme / Source | Example Pattern | Handling |
|---|---|---|
| Local file URI | `file:///var/mobile/.../photo.jpg` | Created directly via `MediaLibrary.createAssetAsync` without remote download. |
| Android content URI | `content://media/external/images/media/123` | Created directly via `MediaLibrary.createAssetAsync` without remote download. |
| Protected backend API URI | `https://<api-host>/api/items/<id>/image/<index>` | Resolved to a short-lived signed URL or authenticated API fallback; downloaded to a temporary cache file, then saved to library. |
| Remote signed storage URI | `https://<storage-host>/...` | Downloaded to a temporary cache file, then saved to library. |
| Unsupported URI | `ftp://...`, data URIs, empty strings | Explicitly rejected with an `unsupported` failure; does not halt batch processing. |

## Authenticated image resolution (`imageRetrieval.ts`)

Protected backend images require Firebase user authentication. The resolution lifecycle proceeds as follows:

```text
[Protected API URI]
         |
  User signed in?
   |           \
 (No)          (Yes)
   |              \
 Throws        Fetch /url with Bearer token
                |                      \
            Success (200)             401 / 403
                |                         \
         Return signed URL        Forced token refresh
         (Cached for TTL)                 |
                                      Retry /url
                                      /        \
                               Success (200)   Failure / Network error
                                     |                    \
                             Return signed URL      Return protected API URI
                                                    + Authorization header fallback
```

### Key contracts:
1. **Single refresh retry:** At most one forced token refresh (`getIdToken(user, true)`) is attempted upon receiving `401` or `403`.
2. **Authenticated fallback preservation:** If the token refresh or second signed-URL request fails, the resolver never throws or drops the photo. Instead, it returns `{ uri: protectedApiUri, headers: { Authorization: `Bearer ${token}` } }` so the download service can still fetch the image directly from the backend API.
3. **Short-lived caching:** Successful signed URLs are cached with TTL in `signedImageUrlCache.ts`.
4. **Cache invalidation:** Listing save operations invalidate cached entries via `clearSignedImageUrlCacheForItem(itemId)`. Before retrying a protected URI that failed authentication or download, the caller invalidates its individual cache entry via `invalidateAuthenticatedImageUri(uri)` so an expired or revoked signed URL is not reused.

## Temporary file lifecycle and cleanup

Remote images cannot be directly inserted into the native media library without local storage backing.

1. **Staging:** Remote bytes are downloaded to `Paths.cache` using uniquely generated filenames (`listflick-download-<timestamp>-<index>-<random>.<ext>`).
2. **Headers:** Any authentication headers returned by `resolveAuthenticatedImageUri` are forwarded to `File.downloadFileAsync`.
3. **Asset Creation:** `MediaLibrary.createAssetAsync(assetUri)` creates the photo asset in the user's camera roll.
4. **Best-effort cleanup:** The temporary file is deleted in a `finally` block on success, download failure, media library failure, or cancellation. A deletion failure is contained because the file remains in the operating system-managed cache.

## Error categorization

Errors are classified into explicit, user-safe categories:

| Category | Cause |
|---|---|
| `unsupported` | Empty URI or unsupported protocol scheme. |
| `authentication` | No signed-in Firebase user, or permanent auth token rejection. |
| `download` | Network timeout, connection error, or HTTP failure during file download. |
| `media_library` | Permission denial, platform asset creation failure, or insufficient storage. |
| `unknown` | Operation aborted via `AbortSignal` or an unclassified runtime error. Every image not processed after cancellation is returned with this category. |

## UX and Safe Retry Behavior

1. **Add-only permission:** Permissions are requested only when the user taps **Save Photos to Device**, specifying `MediaLibrary.requestPermissionsAsync(true, ["photo"])`.
2. **Busy state & duplicate prevention:** While saving is active, `savingPhotos` is set to `true`. The overflow menu remains visible and disabled with "Saving Photos...", and the screen header mirrors that status so progress remains visible outside the menu.
3. **Result presentation:**
   - *All saved:* "Saved N photos to your camera roll."
   - *Partially saved:* "Saved X of N photos. Some photos could not be downloaded." with options `[Cancel, Try Again]`.
   - *Zero saved:* "No photos could be saved. Check your connection and try again." with options `[Cancel, Try Again]`.
4. **Deduplication and cache refresh on retry:** When the user taps **Try Again**, the caller filters the batch to only the failed URIs (`urisToSave[f.index]`). It first invalidates cached protected-image resolutions for authentication and download failures. Photos that were successfully saved on the previous attempt are **not** re-saved, preventing duplicate images in the device library.
5. **Web platform guard:** Saving photos is explicitly not supported on web; mobile callers check `Platform.OS === "web"` and present an explanatory alert without requesting native permissions.
