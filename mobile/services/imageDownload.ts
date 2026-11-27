import * as MediaLibrary from "expo-media-library/legacy";
import { File, Paths } from "expo-file-system";

import { resolveAuthenticatedImageUri } from "./imageRetrieval";
import type { ImageDownloadFailure, ImageDownloadResult } from "../utils/imageDownloadResult";

function isLocalUri(uri: string): boolean {
  return uri.startsWith("file://") || uri.startsWith("content://");
}

function isRemoteUri(uri: string): boolean {
  return uri.startsWith("http://") || uri.startsWith("https://");
}

function failureCategory(error: unknown): ImageDownloadFailure["category"] {
  if (error instanceof Error && /authentication|required|401|403/i.test(error.message)) return "authentication";
  return "download";
}

function temporaryName(index: number, uri: string): string {
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(uri)?.[1] ?? "jpg";
  return `listflick-download-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}.${extension}`;
}

export type SaveListingImagesOptions = {
  signal?: AbortSignal;
};

export async function saveListingImagesToLibrary(
  imageUris: string[],
  options?: SaveListingImagesOptions,
): Promise<ImageDownloadResult> {
  const result: ImageDownloadResult = { total: imageUris.length, saved: 0, failures: [] };
  for (const [index, sourceUri] of imageUris.entries()) {
    if (options?.signal?.aborted) {
      for (let cancelledIndex = index; cancelledIndex < imageUris.length; cancelledIndex += 1) {
        result.failures.push({ index: cancelledIndex, category: "unknown" });
      }
      break;
    }
    let temporaryFile: File | null = null;
    try {
      if (!sourceUri || (!isLocalUri(sourceUri) && !isRemoteUri(sourceUri))) {
        throw Object.assign(new Error("Unsupported image URI"), { category: "unsupported" });
      }
      let assetUri = sourceUri;
      if (!isLocalUri(sourceUri)) {
        const resolved = await resolveAuthenticatedImageUri(sourceUri);
        if (options?.signal?.aborted) {
          throw Object.assign(new Error("Operation aborted"), { category: "unknown" });
        }
        temporaryFile = new File(Paths.cache, temporaryName(index, resolved.uri));
        await File.downloadFileAsync(resolved.uri, temporaryFile, {
          headers: resolved.headers,
          idempotent: true,
        });
        assetUri = temporaryFile.uri;
      }
      if (options?.signal?.aborted) {
        throw Object.assign(new Error("Operation aborted"), { category: "unknown" });
      }
      try {
        // saveToLibraryAsync only needs add-only access; createAssetAsync reads the
        // new asset back, which fails (after adding it) without full read access.
        await MediaLibrary.saveToLibraryAsync(assetUri);
      } catch (mediaError) {
        throw Object.assign(
          mediaError instanceof Error ? mediaError : new Error(String(mediaError)),
          { category: "media_library" as const },
        );
      }
      result.saved += 1;
    } catch (error) {
      const category = (error as { category?: ImageDownloadFailure["category"] }).category;
      result.failures.push({ index, category: category ?? failureCategory(error) });
    } finally {
      try {
        if (temporaryFile?.exists) temporaryFile.delete();
      } catch {
        // Cleanup is best effort; the cache remains system-managed.
      }
    }
  }
  return result;
}
