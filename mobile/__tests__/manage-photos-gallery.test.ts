import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createManagePhotoEntries,
  nearestViewerPhotoKey,
  photoLoadStateAfterEnd,
  viewerPageKeyAfterMomentum,
} from "../utils/managePhotos";
import {
  clearSignedImageUrlCache,
  clearSignedImageUrlCacheForUri,
  getSignedUrlEntry,
  getSignedUrlRequest,
  setSignedUrlEntry,
  setSignedUrlRequest,
} from "../utils/signedImageUrlCache";

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const original = createManagePhotoEntries(["local-a", "remote-b"], []);
const reordered = createManagePhotoEntries(["remote-b", "local-a"], []);
equal(original[0].key, reordered[1].key, "photo identity survives reordering");
equal(original[1].key, reordered[0].key, "every unique photo keeps its identity");

const duplicates = createManagePhotoEntries(["same-uri", "same-uri"], []);
equal(duplicates[0].key === duplicates[1].key, false, "duplicate image URIs remain distinct");

equal(
  nearestViewerPhotoKey(original, original[1].key, 0),
  original[1].key,
  "viewer keeps the selected photo when it remains",
);
equal(
  nearestViewerPhotoKey([original[0]], original[1].key, 1),
  original[0].key,
  "viewer clamps to the nearest remaining photo",
);
equal(
  nearestViewerPhotoKey([], original[1].key, 1),
  null,
  "viewer closes when no photo remains",
);
equal(
  viewerPageKeyAfterMomentum(original, 1, false),
  original[1].key,
  "viewer applies paging events while open",
);
equal(
  viewerPageKeyAfterMomentum(original, 1, true),
  null,
  "viewer ignores late paging events after close starts",
);
equal(photoLoadStateAfterEnd(undefined), "loaded", "load-end recovers a missing load event");
equal(photoLoadStateAfterEnd("loading"), "loaded", "load-end completes a pending image");
equal(photoLoadStateAfterEnd("error"), "error", "load-end does not overwrite an image error");
clearSignedImageUrlCache();
const expiresAt = Date.now() + 3_600_000;
const failedKey = "user-1:https://api.test/api/items/item-1/image/0";
const retainedKey = "user-1:https://api.test/api/items/item-1/image/1";
setSignedUrlEntry(failedKey, { url: "https://storage.test/failed", expiresAt });
setSignedUrlEntry(retainedKey, { url: "https://storage.test/retained", expiresAt });
setSignedUrlRequest(failedKey, Promise.resolve("https://storage.test/failed"));

clearSignedImageUrlCacheForUri("user-1", "https://api.test/api/items/item-1/image/0");
equal(getSignedUrlEntry(failedKey), undefined, "retry clears only the failed signed URL");
equal(getSignedUrlRequest(failedKey), undefined, "retry clears the failed in-flight resolution");
equal(Boolean(getSignedUrlEntry(retainedKey)), true, "retry preserves other image cache entries");
clearSignedImageUrlCache();

const screenSource = readFileSync(resolve(__dirname, "../app/manage-photos.tsx"), "utf8");
const viewerSource = readFileSync(
  resolve(__dirname, "../components/managePhotos/PhotoViewer.tsx"),
  "utf8",
);
const authenticatedImageSource = readFileSync(
  resolve(__dirname, "../components/AuthenticatedImage.tsx"),
  "utf8",
);

equal(
  screenSource.includes("<AuthenticatedImage"),
  true,
  "Manage Photos uses the authenticated image boundary",
);
equal(
  screenSource.includes("delayLongPress={400}"),
  true,
  "Manage Photos retains a deliberate long-press drag gesture",
);
equal(
  screenSource.includes("Tap a photo to view it. Hold and drag to reorder."),
  true,
  "Manage Photos explains tap and drag ownership",
);
equal(screenSource.includes("onLoadEnd={() => finishImageLoad(item.key)}"), true, "grid handles cached-image load completion");
equal(viewerSource.includes("onLoadEnd={() => finishImageLoad(photo.key)}"), true, "viewer handles cached-image load completion");
equal(
  screenSource.includes('onSourceResolved={() => setImageState(item.key, "loaded")}'),
  true,
  "grid stops loading when its authenticated source is attached",
);
equal(
  screenSource.includes('onLoadStart={() => setImageState(item.key, "loading")}'),
  false,
  "a late native load-start cannot restore the grid spinner",
);
equal(
  viewerSource.includes('onSourceResolved={() => setImageState(photo.key, "loaded")}'),
  true,
  "viewer stops loading when its authenticated source is attached",
);
equal(
  viewerSource.includes('onLoadStart={() => setImageState(photo.key, "loading")}'),
  false,
  "a late native load-start cannot restore the viewer spinner",
);
equal(
  screenSource.includes('if (state !== "loaded") return;'),
  false,
  "a stale loading state cannot block opening a visible image",
);
equal(
  screenSource.includes('imageState === "loading" ? "Loading" : "Open"'),
  true,
  "grid accessibility distinguishes loading photos from ready photos",
);
equal(
  viewerSource.includes("const [imageStates, setImageStates] = useState"),
  true,
  "viewer owns its image loading state",
);
equal(
  screenSource.includes("imageStates={imageStates}"),
  false,
  "grid loading state is not passed into the viewer",
);
equal(
  screenSource.includes("onImageStateChange={setImageState}"),
  false,
  "viewer cannot mutate grid loading state",
);
const loadingOverlaySource = screenSource.slice(
  screenSource.indexOf("imageStateOverlay: {"),
  screenSource.indexOf("imageErrorOverlay: {"),
);
equal(
  loadingOverlaySource.includes("backgroundColor"),
  false,
  "loading indicator does not obscure a cached image",
);
equal(
  authenticatedImageSource.includes("onErrorRef.current?.({"),
  true,
  "authenticated source-resolution failures reach the image error callback",
);
equal(
  authenticatedImageSource.includes("onSourceResolvedRef.current?.()"),
  true,
  "authenticated image reports when its renderable source is attached",
);
equal(viewerSource.includes("pagingEnabled"), true, "photo viewer supports horizontal paging");
equal(viewerSource.includes("onRequestClose={closeViewer}"), true, "platform back uses guarded close");
equal(viewerSource.includes("onDismiss={closeViewer}"), true, "native sheet dismissal clears viewer state");
equal(viewerSource.includes("onPress={closeViewer}"), true, "visible close uses guarded close");
equal(
  viewerSource.includes('presentationStyle="pageSheet"'),
  true,
  "viewer uses native iOS sheet presentation",
);
equal(
  viewerSource.includes("transparent={false}"),
  true,
  "native page sheet presentation remains enabled",
);
equal(viewerSource.includes("allowSwipeDismissal"), true, "native sheet permits swipe dismissal");
equal(
  viewerSource.includes("backgroundColor: theme.colors.background"),
  true,
  "native sheet uses the light ListFlick surface",
);
equal(viewerSource.includes("resizeMode=\"contain\""), true, "viewer shows the complete photo");
equal(viewerSource.includes("Photo {selectedIndex + 1} of {photos.length}"), true, "viewer reports position");

console.log("Manage Photos gallery tests passed.");
