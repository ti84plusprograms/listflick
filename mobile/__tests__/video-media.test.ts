import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MANAGE_VIDEO_NOTE,
  ONE_VIDEO_FIRST_ADDED_NOTICE,
  ONE_VIDEO_REPLACED_NOTICE,
  addVideoNotice,
  cameraRollItems,
  formatVideoDuration,
  frameSampleTimes,
  isVideoAsset,
  listingVideoFromItem,
  manageMediaLabel,
  marketplaceHintRows,
  saveMediaLabel,
  videoChanged,
  videoExtension,
  videoMimeType,
} from "../utils/listingVideo";
import {
  MISSING_PENDING_VIDEO_MESSAGE,
  assertPendingVideoAvailable,
  createPendingAnalysisOperation,
  parsePendingAnalysisOperation,
  pendingOperationHasMedia,
  rebasePendingAnalysisOperation,
} from "../utils/pendingAnalysis";
import { parseListingWorkspaceParams, listingWorkspaceToParams } from "../utils/listingWorkspace";

function equal<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function expectIncludes(source: string, expected: string, label: string): void {
  if (!source.includes(expected)) throw new Error(`${label} is missing ${JSON.stringify(expected)}`);
}

const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");

// Durations and frame sampling.
equal(formatVideoDuration(7.4), "0:07", "short duration");
equal(formatVideoDuration(65), "1:05", "minute duration");
equal(formatVideoDuration(Number.NaN), "0:00", "invalid duration");

const shortTimes = frameSampleTimes(2);
equal(shortTimes.length, 6, "at least 6 candidate frames");
equal(frameSampleTimes(10).length, 15, "about 1.5 frames per second");
equal(frameSampleTimes(60).length, 24, "at most 24 candidate frames");
equal(shortTimes[0] > 0 && shortTimes[shortTimes.length - 1] < 2, true, "skips the very start and end");
equal(
  frameSampleTimes(10).every((time, index, all) => index === 0 || time > all[index - 1]),
  true,
  "frame times increase evenly",
);

// Recognizing and naming video files.
equal(isVideoAsset({ type: "video", uri: "file:///x" }), true, "picker video type");
equal(isVideoAsset({ type: "image", uri: "file:///x.jpg" }), false, "picker image");
equal(isVideoAsset({ uri: "file:///clip.MOV" }), true, "extension fallback");
equal(videoExtension("file:///a/clip.mov"), "mov", "mov extension");
equal(videoExtension("https://api.test/api/items/1/video/v1"), "mp4", "extensionless defaults to mp4");
equal(videoMimeType("file:///a/clip.mov"), "video/quicktime", "mov mime type");
equal(videoMimeType("file:///a/clip", "video/webm"), "video/webm", "picker mime type wins");

// One video per listing.
equal(addVideoNotice(null), null, "first video has no notice");
equal(addVideoNotice({ uri: "file:///a.mp4", durationSeconds: 3 }), ONE_VIDEO_REPLACED_NOTICE, "second video replaces the first");
equal(addVideoNotice(null, 2), ONE_VIDEO_FIRST_ADDED_NOTICE, "picking two videos keeps the first");

// Backend video and Manage Photos changes.
const backend = listingVideoFromItem({
  id: "v1",
  url: "/api/items/item-1/video/v1",
  content_type: "video/mp4",
  size_bytes: 1200,
  duration_seconds: 9.5,
  frame_count: 4,
  cover_from_video: false,
});
equal(backend, { uri: "/api/items/item-1/video/v1", durationSeconds: 9.5, mimeType: "video/mp4", sizeBytes: 1200, videoId: "v1" }, "item video maps to the workspace");
equal(listingVideoFromItem(null), null, "no video");
equal(videoChanged(backend, backend), null, "unchanged video");
equal(videoChanged(backend, null), "remove", "removed video");
equal(videoChanged(backend, { uri: "file:///new.mov", durationSeconds: 4 }), "upload", "replaced video");
equal(videoChanged(null, null), null, "never had a video");

// Camera roll order: cover first, photos in order, video last.
equal(
  cameraRollItems(["cover.jpg", "two.jpg"], "video.mp4"),
  [
    { uri: "cover.jpg", kind: "photo" },
    { uri: "two.jpg", kind: "photo" },
    { uri: "video.mp4", kind: "video" },
  ],
  "camera roll order",
);
equal(saveMediaLabel(true, false), "Save Photos & Video", "save label with video");
equal(saveMediaLabel(false, false), "Save Photos to Device", "save label without video");
equal(manageMediaLabel(true), "Manage Photos & Video", "manage label with video");

// "Ready for Marketplace" hint.
equal(
  marketplaceHintRows(3, backend),
  [
    { label: "Photos", text: "3 in this order. Photo 1 is the cover." },
    { label: "Video", text: "Add it with Marketplace's 'Add video' button, not in the photos." },
  ],
  "hint rows with a video",
);
equal(marketplaceHintRows(2, null).length, 1, "no video row without a video");
equal(marketplaceHintRows(0, null), [], "nothing to post");
equal(MANAGE_VIDEO_NOTE, "On Marketplace this goes in the separate 'Add video' slot. It won't replace your cover photo.", "Manage Photos note");

// Pending analysis keeps the video (and its frames) across restarts.
const video = {
  uri: "file:///old/Documents/pending-analysis/op-1/video.mov",
  durationSeconds: 8,
  frames: [{ uri: "file:///old/Documents/pending-analysis/op-1/frame-1.jpg", time: 0.3 }],
};
const operation = createPendingAnalysisOperation([], { operationId: "op-1", now: 0, video });
equal(pendingOperationHasMedia(operation), true, "a video alone is enough to start a listing");
equal(pendingOperationHasMedia(createPendingAnalysisOperation([], { operationId: "op-2", now: 0 })), false, "nothing selected");
const parsed = parsePendingAnalysisOperation(JSON.stringify(operation));
equal(parsed?.video?.frames.length, 1, "video survives persistence");
equal(parsePendingAnalysisOperation(JSON.stringify({ ...operation, video: { uri: 3 } })), null, "malformed video is rejected");
const rebased = rebasePendingAnalysisOperation(operation, "file:///new/Documents/");
equal(rebased.video?.uri, "file:///new/Documents/pending-analysis/op-1/video.mov", "video path follows the app container");
equal(rebased.video?.frames[0].uri, "file:///new/Documents/pending-analysis/op-1/frame-1.jpg", "frame paths follow too");
let missingError = "";
try {
  assertPendingVideoAvailable(video, () => false);
} catch (error) {
  missingError = (error as Error).message;
}
equal(missingError, MISSING_PENDING_VIDEO_MESSAGE, "a missing local video fails clearly");
assertPendingVideoAvailable({ ...video, uploaded: true }, () => false);

// Workspace params carry the video between screens.
const params = listingWorkspaceToParams({ ...parseListingWorkspaceParams({ itemId: "item-1" }), video: backend });
equal(parseListingWorkspaceParams(params).video, backend, "video round-trips through route params");

// Source wiring.
const camera = read("../app/camera.tsx");
for (const expected of [
  'mediaTypes: ["images", "videos"]',
  "maxDuration: MAX_VIDEO_SECONDS,",
  "maxFileSize: MAX_RECORDING_BYTES,",
  "sizeBytes: recordedFileSize(recorded.uri),",
  "recordingBusy.current = true;",
  "stopRecording()",
  "useMicrophonePermissions",
  "mute={!microphonePermission?.granted}",
  'mode={captureMode === "video" ? "video" : "picture"}',
  "addVideoNotice(",
  "extractVideoFrames(",
  "persistPendingAnalysisVideo(",
  "video={video}",
]) {
  expectIncludes(camera, expected, "Camera");
}
expectIncludes(read("../components/camera/CameraPreview.tsx"), 'videoQuality="720p"', "Camera preview");
expectIncludes(read("../app/processing.tsx"), "await persist({ video: undefined });", "Processing skips a refused video");
const preview = read("../components/camera/CameraPreview.tsx");
expectIncludes(preview, "mode={mode}", "Camera preview");
expectIncludes(preview, "mute={mute}", "Camera preview");
const tray = read("../components/camera/PhotoManager.tsx");
expectIncludes(tray, "formatVideoDuration(video.durationSeconds)", "Tray duration badge");

const processing = read("../app/processing.tsx");
expectIncludes(processing, "uploadVideoListing(pendingVideo, pendingVideo.frames, stableOperationId)", "Processing (video only)");
expectIncludes(processing, "uploadItemVideo(operation!.itemId, pendingVideo, pendingVideo.frames)", "Processing (photos + video)");
expectIncludes(processing, "video: { ...pendingVideo, uploaded: true }", "Processing resume");

const api = read("../services/api.ts");
for (const expected of ['"/api/items/upload-video"', "`/api/items/${itemId}/video`", '"frame_times"', '"duration"', "VIDEO_UPLOAD_TIMEOUT_MS"]) {
  expectIncludes(api, expected, "API");
}

const managePhotos = read("../app/manage-photos.tsx");
for (const expected of ["<ListingVideoPlayer", "Replace", "Remove", "MANAGE_VIDEO_NOTE", "uploadItemVideo(itemId, video)", "deleteItemVideo(itemId)"]) {
  expectIncludes(managePhotos, expected, "Manage Photos");
}

const review = read("../app/review.tsx");
for (const expected of [
  "<ImageCarousel imageUris={localImageUris} video={listing.video} />",
  "<MarketplaceHint",
  "saveListingMediaToLibrary(urisToSave, videoUri)",
  'videoUri ? ["photo", "video"] : ["photo"]',
  "Linking.openSettings()",
  "notionSyncStatus.warnings",
  "listingVideoFromItem(item.video)",
]) {
  expectIncludes(review, expected, "Review");
}

const checklist = read("../components/listing/ReadyChecklist.tsx");
expectIncludes(checklist, "hasVideo: Boolean(listing.video)", "Checklist");
expectIncludes(checklist, "checklist.optional.map", "Checklist");

const appJson = JSON.parse(read("../app.json")) as { expo: { plugins: unknown[] } };
const pluginOptions = (name: string) =>
  (appJson.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === name) as [string, Record<string, unknown>])?.[1];
equal(typeof pluginOptions("expo-camera")?.microphonePermission, "string", "microphone usage string for recording");
equal(pluginOptions("expo-camera")?.recordAudioAndroid, true, "Android can record sound");
equal(pluginOptions("expo-image-picker")?.microphonePermission !== false, true, "the picker must not block the microphone the camera records with");
equal(pluginOptions("expo-media-library")?.granularPermissions, ["photo", "video"], "saving videos needs video access");
equal(Boolean(pluginOptions("expo-video")), true, "expo-video plugin configured");

const pkg = JSON.parse(read("../package.json")) as { dependencies: Record<string, string> };
equal(Boolean(pkg.dependencies["expo-video"]), true, "expo-video dependency");
equal(Boolean(pkg.dependencies["expo-video-thumbnails"]), true, "expo-video-thumbnails dependency");

console.log("video media tests passed");
