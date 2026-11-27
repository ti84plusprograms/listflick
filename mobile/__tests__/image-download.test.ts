(globalThis as any).__DEV__ = false;

import Module from "node:module";

const savedAssets: string[] = [];
const downloadedFiles: { uri: string; dest: string; headers?: Record<string, string> }[] = [];
const deletedFiles: string[] = [];

class MockFile {
  exists = true;
  uri: string;
  constructor(dir: string, name: string) {
    this.uri = `${dir}/${name}`;
  }
  delete() {
    this.exists = false;
    deletedFiles.push(this.uri);
  }
  static async downloadFileAsync(url: string, file: MockFile, options?: { headers?: Record<string, string> }) {
    if (mockDownloadError) throw mockDownloadError;
    downloadedFiles.push({ uri: url, dest: file.uri, headers: options?.headers });
    mockAfterDownload?.();
  }
}

let mockSaveError: Error | null = null;
let mockDownloadError: Error | null = null;
let mockAfterDownload: (() => void) | null = null;
let mockResolveAuthUri: ((uri: string) => Promise<{ uri: string; headers?: Record<string, string> }>) | null = null;

const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
  if (request.includes("expo-media-library")) {
    return {
      // Only saveToLibraryAsync is provided: it needs add-only photo access.
      // createAssetAsync reads the asset back (needs read access) and must not be used.
      saveToLibraryAsync: async (uri: string): Promise<void> => {
        if (mockSaveError) throw mockSaveError;
        savedAssets.push(uri);
      },
    };
  }
  if (request.includes("expo-file-system")) {
    return {
      Paths: { cache: "/mock/cache" },
      File: MockFile,
    };
  }
  if (request.includes("imageRetrieval")) {
    return {
      resolveAuthenticatedImageUri: async (uri: string) => {
        if (mockResolveAuthUri) return mockResolveAuthUri(uri);
        return { uri };
      },
    };
  }
  if (request.includes("react-native")) {
    return { Platform: { OS: "ios" } };
  }
  return originalLoad.apply(this, arguments);
};

const { saveListingImagesToLibrary, saveListingMediaToLibrary } = require("../services/imageDownload") as typeof import("../services/imageDownload");
import { formatImageDownloadResult } from "../utils/imageDownloadResult";

function equal<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function resetMocks(): void {
  savedAssets.length = 0;
  downloadedFiles.length = 0;
  deletedFiles.length = 0;
  mockSaveError = null;
  mockDownloadError = null;
  mockAfterDownload = null;
  mockResolveAuthUri = null;
}

async function runTests() {
  // 1. Local file:// URI saves directly without remote download
  resetMocks();
  const fileResult = await saveListingImagesToLibrary(["file:///var/mobile/Containers/Data/photo.jpg"]);
  equal(fileResult, { total: 1, saved: 1, failures: [] }, "file:// saves successfully");
  equal(savedAssets, ["file:///var/mobile/Containers/Data/photo.jpg"], "MediaLibrary receives local file:// URI");
  equal(downloadedFiles.length, 0, "no download performed for file:// URI");

  // 2. Android content:// URI saves directly without remote download
  resetMocks();
  const contentResult = await saveListingImagesToLibrary(["content://media/external/images/media/100"]);
  equal(contentResult, { total: 1, saved: 1, failures: [] }, "content:// saves successfully");
  equal(savedAssets, ["content://media/external/images/media/100"], "MediaLibrary receives content:// URI");
  equal(downloadedFiles.length, 0, "no download performed for content:// URI");

  // 3. Remote URI downloads to temp file with auth headers, saves it, and cleans up temp file
  resetMocks();
  mockResolveAuthUri = async (uri) => ({
    uri: "https://signed.storage.test/item-1.jpg",
    headers: { Authorization: "Bearer test-jwt-token" },
  });

  const remoteResult = await saveListingImagesToLibrary(["https://api.test/items/1/image/0"]);
  equal(remoteResult, { total: 1, saved: 1, failures: [] }, "remote image saves successfully");
  equal(downloadedFiles.length, 1, "downloadFileAsync called once");
  equal(downloadedFiles[0].uri, "https://signed.storage.test/item-1.jpg", "downloads resolved signed URL");
  equal(downloadedFiles[0].headers?.["Authorization"], "Bearer test-jwt-token", "passes auth headers to downloader");
  equal(savedAssets.length, 1, "asset created in media library");
  equal(savedAssets[0].startsWith("/mock/cache/listflick-download-"), true, "saves from temporary cache file");
  equal(deletedFiles.length, 1, "temporary file was cleaned up on success");
  equal(deletedFiles[0], savedAssets[0], "deleted the exact temporary file that was created");

  // 4. Temporary file cleanup on download failure
  resetMocks();
  mockDownloadError = new Error("Network timeout during image download");
  const downloadFailResult = await saveListingImagesToLibrary(["https://api.test/items/1/image/0"]);
  equal(
    downloadFailResult,
    { total: 1, saved: 0, failures: [{ index: 0, category: "download" }] },
    "categorized as download failure",
  );
  equal(deletedFiles.length, 1, "temporary file was cleaned up even when download failed");
  equal(savedAssets.length, 0, "no media library asset created on download failure");

  // 5. Temporary file cleanup and accurate categorization on MediaLibrary failure (defect fix proof)
  resetMocks();
  mockSaveError = new Error("User denied photo-library write access");
  const mediaFailResult = await saveListingImagesToLibrary(["https://api.test/items/1/image/0"]);
  equal(
    mediaFailResult,
    { total: 1, saved: 0, failures: [{ index: 0, category: "media_library" }] },
    "media library error categorized as media_library, NOT download",
  );
  equal(deletedFiles.length, 1, "temporary file was cleaned up when media library failed");

  // 6. Authentication failure categorization
  resetMocks();
  mockResolveAuthUri = async () => {
    throw new Error("Authentication required to access this image.");
  };
  const authFailResult = await saveListingImagesToLibrary(["https://api.test/items/1/image/0"]);
  equal(
    authFailResult,
    { total: 1, saved: 0, failures: [{ index: 0, category: "authentication" }] },
    "auth resolution error categorized as authentication",
  );

  // 7. Unsupported URI categorization
  resetMocks();
  const unsupportedResult = await saveListingImagesToLibrary(["ftp://files.test/image.png", ""]);
  equal(
    unsupportedResult,
    {
      total: 2,
      saved: 0,
      failures: [
        { index: 0, category: "unsupported" },
        { index: 1, category: "unsupported" },
      ],
    },
    "unsupported and empty URIs categorized as unsupported",
  );

  // 8. Mixed-batch continuation: processes all items, continues past failures, counts correctly
  resetMocks();
  mockResolveAuthUri = async (uri) => {
    if (uri.includes("auth-fail")) throw new Error("401 Unauthorized token expired");
    return { uri: `https://storage.test/resolved-${uri}` };
  };

  const mixedUris = [
    "file:///local/photo-1.jpg",
    "https://api.test/auth-fail.jpg",
    "content://media/external/images/media/200",
    "ftp://invalid/photo.jpg",
    "https://api.test/success.jpg",
  ];

  const mixedResult = await saveListingImagesToLibrary(mixedUris);
  equal(mixedResult.total, 5, "total count is 5");
  equal(mixedResult.saved, 3, "3 items saved (2 local, 1 remote)");
  equal(mixedResult.failures, [
    { index: 1, category: "authentication" },
    { index: 3, category: "unsupported" },
  ], "failures accurately recorded with index and category");
  equal(savedAssets.length, 3, "3 assets created in library");

  // 9. Cancellation via AbortSignal
  resetMocks();
  const controller = new AbortController();
  controller.abort();
  const cancelledResult = await saveListingImagesToLibrary(
    ["file:///local/1.jpg", "file:///local/2.jpg", "file:///local/3.jpg"],
    { signal: controller.signal },
  );
  equal(cancelledResult.saved, 0, "no images saved when aborted upfront");
  equal(
    cancelledResult,
    {
      total: 3,
      saved: 0,
      failures: [
        { index: 0, category: "unknown" },
        { index: 1, category: "unknown" },
        { index: 2, category: "unknown" },
      ],
    },
    "an upfront cancellation accounts for every unprocessed image",
  );

  // 10. A saveToLibraryAsync rejection on a local URI is a media_library failure
  resetMocks();
  mockSaveError = new Error("The operation couldn't be completed. (PHPhotosErrorDomain error 3311.)");
  const localMediaFailResult = await saveListingImagesToLibrary(["file:///local/photo.jpg"]);
  equal(
    localMediaFailResult,
    { total: 1, saved: 0, failures: [{ index: 0, category: "media_library" }] },
    "saveToLibraryAsync rejection categorized as media_library",
  );
  equal(downloadedFiles.length, 0, "no download performed for local media_library failure");

  // 11. Abort during remote URL resolution (before any download): nothing downloaded or saved
  resetMocks();
  const lateController = new AbortController();
  mockResolveAuthUri = async (uri) => {
    lateController.abort();
    return { uri: `https://storage.test/${uri.length}.jpg` };
  };
  const lateAbortResult = await saveListingImagesToLibrary(
    ["https://api.test/items/1/image/0", "file:///local/2.jpg"],
    { signal: lateController.signal },
  );
  equal(
    lateAbortResult,
    { total: 2, saved: 0, failures: [{ index: 0, category: "unknown" }, { index: 1, category: "unknown" }] },
    "abort mid-batch accounts for the in-flight and remaining images",
  );
  equal(savedAssets.length, 0, "nothing saved after abort");
  equal(downloadedFiles.length, 0, "nothing downloaded after abort during resolution");

  // 11b. Abort AFTER File.downloadFileAsync completes but before saving:
  // the post-download abort check stops the save and the temp file is deleted
  resetMocks();
  const postDownloadController = new AbortController();
  mockAfterDownload = () => postDownloadController.abort();
  const postDownloadAbortResult = await saveListingImagesToLibrary(
    ["https://api.test/items/1/image/0", "file:///local/2.jpg"],
    { signal: postDownloadController.signal },
  );
  equal(
    postDownloadAbortResult,
    { total: 2, saved: 0, failures: [{ index: 0, category: "unknown" }, { index: 1, category: "unknown" }] },
    "abort after download counts the downloaded photo and the rest as failures",
  );
  equal(downloadedFiles.length, 1, "the in-flight photo was downloaded before the abort");
  equal(savedAssets.length, 0, "post-download abort stops the save");
  equal(deletedFiles, [downloadedFiles[0].dest], "temp file deleted after post-download abort");

  // 12. Alert result formatting tests
  equal(
    formatImageDownloadResult({ total: 2, saved: 2, failures: [] }),
    { title: "Saved", message: "Saved 2 photos to your camera roll." },
    "all-success result reports the exact saved count",
  );
  equal(
    formatImageDownloadResult({ total: 1, saved: 1, failures: [] }),
    { title: "Saved", message: "Saved 1 photo to your camera roll." },
    "single success uses singular wording",
  );
  equal(
    formatImageDownloadResult({
      total: 3,
      saved: 1,
      failures: [{ index: 1, category: "download" }, { index: 2, category: "authentication" }],
    }),
    { title: "Partially saved", message: "Saved 1 of 3 photos. Some photos could not be downloaded." },
    "partial download/auth result keeps the download message",
  );
  equal(
    formatImageDownloadResult({
      total: 3,
      saved: 1,
      failures: [{ index: 1, category: "media_library" }, { index: 2, category: "media_library" }],
    }),
    {
      title: "Partially saved",
      message:
        "Saved 1 of 3 photos. ListFlick couldn't add the rest to your library. Check that Photos access is allowed for ListFlick in Settings, then try again.",
    },
    "partial media_library result points to Settings, not the network",
  );
  equal(
    formatImageDownloadResult({
      total: 3,
      saved: 1,
      failures: [{ index: 1, category: "download" }, { index: 2, category: "media_library" }],
    }),
    {
      title: "Partially saved",
      message: "Saved 1 of 3 photos. Some photos could not be downloaded or added to your library.",
    },
    "partial mixed result names both causes",
  );
  equal(
    formatImageDownloadResult({
      total: 2,
      saved: 0,
      failures: [{ index: 0, category: "media_library" }, { index: 1, category: "media_library" }],
    }),
    {
      title: "Photos not saved",
      message:
        "ListFlick couldn't add the photos to your library. Check that Photos access is allowed for ListFlick in Settings, then try again.",
    },
    "all-media_library failure points to Settings",
  );
  equal(
    /connection/i.test(
      formatImageDownloadResult({ total: 1, saved: 0, failures: [{ index: 0, category: "media_library" }] }).message,
    ),
    false,
    "media_library failure never mentions the connection",
  );
  equal(
    formatImageDownloadResult({
      total: 2,
      saved: 0,
      failures: [{ index: 0, category: "unsupported" }, { index: 1, category: "download" }],
    }),
    { title: "Photos not saved", message: "No photos could be saved. Check your connection and try again." },
    "zero-save download result keeps the connection message",
  );
  equal(
    formatImageDownloadResult({
      total: 2,
      saved: 0,
      failures: [{ index: 0, category: "authentication" }, { index: 1, category: "download" }],
    }),
    { title: "Photos not saved", message: "No photos could be saved. Check your connection and try again." },
    "zero-save authentication result keeps the connection message",
  );
  equal(
    formatImageDownloadResult({
      total: 2,
      saved: 0,
      failures: [{ index: 0, category: "download" }, { index: 1, category: "media_library" }],
    }),
    {
      title: "Photos not saved",
      message:
        "No photos could be saved. Some could not be downloaded and others couldn't be added to your library. Check your connection and that Photos access is allowed for ListFlick in Settings, then try again.",
    },
    "zero-save mixed result names both causes",
  );
  const SETTINGS_ONLY =
    "ListFlick couldn't add the photos to your library. Check that Photos access is allowed for ListFlick in Settings, then try again.";
  equal(
    formatImageDownloadResult({
      total: 2,
      saved: 0,
      failures: [{ index: 0, category: "media_library" }, { index: 1, category: "unsupported" }],
    }),
    { title: "Photos not saved", message: SETTINGS_ONLY },
    "zero-save media_library + unsupported uses the Settings message, not the connection",
  );
  equal(
    formatImageDownloadResult({
      total: 2,
      saved: 0,
      failures: [{ index: 0, category: "media_library" }, { index: 1, category: "unknown" }],
    }),
    { title: "Photos not saved", message: SETTINGS_ONLY },
    "zero-save media_library + unknown uses the Settings message, not the connection",
  );
  equal(
    formatImageDownloadResult({
      total: 2,
      saved: 0,
      failures: [{ index: 0, category: "unsupported" }, { index: 1, category: "unknown" }],
    }),
    { title: "Photos not saved", message: "No photos could be saved. Try again." },
    "zero-save unsupported/unknown only blames neither network nor library",
  );
  equal(
    formatImageDownloadResult({
      total: 3,
      saved: 1,
      failures: [{ index: 1, category: "media_library" }, { index: 2, category: "unsupported" }],
    }),
    {
      title: "Partially saved",
      message:
        "Saved 1 of 3 photos. ListFlick couldn't add some photos to your library. Check that Photos access is allowed for ListFlick in Settings, then try again.",
    },
    "partial media_library + unsupported points to Settings, not the network",
  );
  equal(
    formatImageDownloadResult({
      total: 3,
      saved: 1,
      failures: [{ index: 1, category: "unsupported" }, { index: 2, category: "unknown" }],
    }),
    { title: "Partially saved", message: "Saved 1 of 3 photos. Some photos could not be saved." },
    "partial unsupported/unknown only blames neither network nor library",
  );

  // 13. Photos and video: cover first, photos in order, the video last.
  resetMocks();
  mockResolveAuthUri = async (uri) => ({ uri: uri.includes("/video/") ? `https://signed.test/video.mov?token=1` : uri });
  const mediaResult = await saveListingMediaToLibrary(
    ["file:///cover.jpg", "file:///second.jpg"],
    "https://api.test/api/items/1/video/v1",
  );
  equal(mediaResult, { total: 3, saved: 3, failures: [], videoIncluded: true }, "photos and video all saved");
  equal(savedAssets.slice(0, 2), ["file:///cover.jpg", "file:///second.jpg"], "photos are saved first, cover first");
  equal(savedAssets[2].endsWith(".mov"), true, "the video is saved last with a video file extension");
  equal(downloadedFiles[0].uri, "https://signed.test/video.mov?token=1", "the video downloads from its signed URL");
  equal(
    formatImageDownloadResult(mediaResult),
    { title: "Saved", message: "Saved 2 photos and the video to your camera roll." },
    "success message mentions the video",
  );

  // A backend video URL without an extension still saves as .mp4 so the library treats it as video.
  resetMocks();
  const fallbackResult = await saveListingMediaToLibrary([], "https://api.test/api/items/1/video/v2");
  equal(fallbackResult.saved, 1, "video-only save works");
  equal(savedAssets[0].endsWith(".mp4"), true, "extensionless video URLs save as .mp4");
  equal(
    formatImageDownloadResult(fallbackResult),
    { title: "Saved", message: "Saved the video to your camera roll." },
    "video-only success message",
  );

  // Without a video the result keeps its original shape.
  resetMocks();
  equal(
    await saveListingMediaToLibrary(["file:///only.jpg"], null),
    { total: 1, saved: 1, failures: [] },
    "no video means no video flag",
  );

  // Video failure is reported on its own.
  resetMocks();
  mockDownloadError = new Error("network down");
  const videoFailed = await saveListingMediaToLibrary(["file:///a.jpg"], "https://api.test/api/items/1/video/v3");
  equal(videoFailed.failures, [{ index: 1, category: "download" }], "the video is the last index");
  equal(
    formatImageDownloadResult(videoFailed).title,
    "Video not saved",
    "photos saved but the video failed",
  );

  console.log("Image download tests passed.");
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
