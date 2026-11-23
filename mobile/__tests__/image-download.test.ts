(globalThis as any).__DEV__ = false;

import Module from "node:module";

const createdAssets: string[] = [];
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
  }
}

let mockCreateAssetError: Error | null = null;
let mockDownloadError: Error | null = null;
let mockResolveAuthUri: ((uri: string) => Promise<{ uri: string; headers?: Record<string, string> }>) | null = null;

const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
  if (request.includes("expo-media-library")) {
    return {
      createAssetAsync: async (uri: string) => {
        if (mockCreateAssetError) throw mockCreateAssetError;
        createdAssets.push(uri);
        return { id: `asset-${createdAssets.length}` };
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

const { saveListingImagesToLibrary } = require("../services/imageDownload") as typeof import("../services/imageDownload");
import { formatImageDownloadResult } from "../utils/imageDownloadResult";

function equal<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function resetMocks(): void {
  createdAssets.length = 0;
  downloadedFiles.length = 0;
  deletedFiles.length = 0;
  mockCreateAssetError = null;
  mockDownloadError = null;
  mockResolveAuthUri = null;
}

async function runTests() {
  // 1. Local file:// URI creates asset directly without remote download
  resetMocks();
  const fileResult = await saveListingImagesToLibrary(["file:///var/mobile/Containers/Data/photo.jpg"]);
  equal(fileResult, { total: 1, saved: 1, failures: [] }, "file:// saves successfully");
  equal(createdAssets, ["file:///var/mobile/Containers/Data/photo.jpg"], "MediaLibrary receives local file:// URI");
  equal(downloadedFiles.length, 0, "no download performed for file:// URI");

  // 2. Android content:// URI creates asset directly without remote download
  resetMocks();
  const contentResult = await saveListingImagesToLibrary(["content://media/external/images/media/100"]);
  equal(contentResult, { total: 1, saved: 1, failures: [] }, "content:// saves successfully");
  equal(createdAssets, ["content://media/external/images/media/100"], "MediaLibrary receives content:// URI");
  equal(downloadedFiles.length, 0, "no download performed for content:// URI");

  // 3. Remote URI downloads to temp file with auth headers, creates asset, and cleans up temp file
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
  equal(createdAssets.length, 1, "asset created in media library");
  equal(createdAssets[0].startsWith("/mock/cache/listflick-download-"), true, "creates asset from temporary cache file");
  equal(deletedFiles.length, 1, "temporary file was cleaned up on success");
  equal(deletedFiles[0], createdAssets[0], "deleted the exact temporary file that was created");

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
  equal(createdAssets.length, 0, "no media library asset created on download failure");

  // 5. Temporary file cleanup and accurate categorization on MediaLibrary failure (defect fix proof)
  resetMocks();
  mockCreateAssetError = new Error("User denied photo-library write access");
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
  equal(createdAssets.length, 3, "3 assets created in library");

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

  // 10. Alert result formatting tests
  equal(
    formatImageDownloadResult({ total: 2, saved: 2, failures: [] }),
    { title: "Saved", message: "Saved 2 photos to your camera roll." },
    "all-success result reports the exact saved count",
  );
  equal(
    formatImageDownloadResult({
      total: 3,
      saved: 1,
      failures: [{ index: 1, category: "download" }, { index: 2, category: "authentication" }],
    }),
    { title: "Partially saved", message: "Saved 1 of 3 photos. Some photos could not be downloaded." },
    "partial result reports saved and failed counts",
  );
  equal(
    formatImageDownloadResult({
      total: 2,
      saved: 0,
      failures: [{ index: 0, category: "unsupported" }, { index: 1, category: "download" }],
    }),
    { title: "Photos not saved", message: "No photos could be saved. Check your connection and try again." },
    "zero-save result never reports success",
  );

  console.log("Image download tests passed.");
}

void runTests();
