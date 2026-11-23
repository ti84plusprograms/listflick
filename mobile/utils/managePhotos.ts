import type { ImageQualityFeedback } from "../types/listing";

export interface ManagePhotoEntry {
  key: string;
  uri: string;
  feedback?: ImageQualityFeedback;
}

export type PhotoLoadState = "loading" | "loaded" | "error";

/**
 * Builds identities that survive reordering. The occurrence suffix keeps
 * duplicate URIs distinct without tying an image to its current grid index.
 */
export function createManagePhotoEntries(
  uris: string[],
  feedback: ImageQualityFeedback[],
): ManagePhotoEntry[] {
  const occurrences = new Map<string, number>();
  return uris.map((uri, index) => {
    const occurrence = occurrences.get(uri) ?? 0;
    occurrences.set(uri, occurrence + 1);
    return {
      key: `photo:${occurrence}:${uri}`,
      uri,
      feedback: feedback.find((item) => item.image_index === index) ?? feedback[index],
    };
  });
}

export function nearestViewerPhotoKey(
  photos: ManagePhotoEntry[],
  selectedKey: string,
  previousIndex: number,
): string | null {
  if (photos.some((photo) => photo.key === selectedKey)) return selectedKey;
  if (photos.length === 0) return null;
  return photos[Math.min(Math.max(previousIndex, 0), photos.length - 1)].key;
}

export function viewerPageKeyAfterMomentum(
  photos: ManagePhotoEntry[],
  index: number,
  isClosing: boolean,
): string | null {
  if (isClosing) return null;
  return photos[index]?.key ?? null;
}

/** Treat load-end as a success fallback without overwriting a reported error. */
export function photoLoadStateAfterEnd(state: PhotoLoadState | undefined): PhotoLoadState {
  return state === "error" ? "error" : "loaded";
}
