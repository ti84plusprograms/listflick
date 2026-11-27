import type { ItemVideo } from "../types/api";
import type { ListingVideo } from "../types/listing";

/**
 * Video helpers shared by the camera, Manage Photos, the preview and the camera-roll
 * save. Facebook Marketplace lets a listing have ONE video, added with a separate
 * "Add video" button; the cover must stay a photo.
 */

export const MAX_VIDEO_SECONDS = 60;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const ONE_VIDEO_REPLACED_NOTICE = "A listing can have one video, so the new one replaced the old one.";
export const ONE_VIDEO_FIRST_ADDED_NOTICE = "Added the first video. A listing can have one video.";
export const MANAGE_VIDEO_NOTE =
  "On Marketplace this goes in the separate 'Add video' slot. It won't replace your cover photo.";
export const MARKETPLACE_PHOTOS_HINT = (count: number) =>
  `${count} in this order. Photo 1 is the cover.`;
export const MARKETPLACE_VIDEO_HINT = "Add it with Marketplace's 'Add video' button, not in the photos.";
export const VIDEO_TOO_LARGE_MESSAGE = "That video is over 100 MB. Record a shorter clip or trim it first.";

const VIDEO_EXTENSIONS: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  qt: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
};

/** 0:07, 1:05 */
export function formatVideoDuration(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function videoExtension(uri: string, mimeType?: string | null): string {
  const fromUri = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(uri)?.[1]?.toLowerCase();
  if (fromUri && VIDEO_EXTENSIONS[fromUri]) return fromUri === "qt" ? "mov" : fromUri;
  const fromType = Object.entries(VIDEO_EXTENSIONS).find(([, type]) => type === mimeType)?.[0];
  return fromType ?? "mp4";
}

export function videoMimeType(uri: string, mimeType?: string | null): string {
  if (mimeType && Object.values(VIDEO_EXTENSIONS).includes(mimeType)) return mimeType;
  return VIDEO_EXTENSIONS[videoExtension(uri, mimeType)] ?? "video/mp4";
}

/** Picker assets: `type` is "video" for videos; fall back to the file name. */
export function isVideoAsset(asset: { type?: string | null; uri: string; mimeType?: string | null }): boolean {
  if (asset.type === "video") return true;
  if (asset.mimeType?.startsWith("video/")) return true;
  return /\.(mov|mp4|m4v|webm|3gp)(?:[?#].*)?$/i.test(asset.uri);
}

/**
 * Candidate frame times for analysis: evenly spaced at about 1.5 per second,
 * 6 to 24 of them, skipping the first and last 4% (often a shaky start or stop).
 * The backend picks the best ones.
 */
export function frameSampleTimes(durationSeconds: number): number[] {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1;
  const count = Math.max(6, Math.min(24, Math.round(duration * 1.5)));
  return Array.from({ length: count }, (_, index) =>
    Math.round(duration * (0.04 + 0.92 * (index / (count - 1))) * 100) / 100,
  );
}

/** Adding a video when one exists replaces it. Returns the notice to show, if any. */
export function addVideoNotice(existing: ListingVideo | null | undefined, pickedCount = 1): string | null {
  if (pickedCount > 1) return ONE_VIDEO_FIRST_ADDED_NOTICE;
  return existing ? ONE_VIDEO_REPLACED_NOTICE : null;
}

export function listingVideoFromItem(video: ItemVideo | null | undefined): ListingVideo | null {
  if (!video?.url) return null;
  return {
    uri: video.url,
    durationSeconds: video.duration_seconds,
    mimeType: video.content_type,
    sizeBytes: video.size_bytes,
    videoId: video.id,
  };
}

export function isLocalVideo(video: ListingVideo | null | undefined): boolean {
  return Boolean(video && /^(file|content|ph):/.test(video.uri));
}

/** True when the Manage Photos video differs from what the backend has. */
export function videoChanged(
  saved: ListingVideo | null | undefined,
  current: ListingVideo | null | undefined,
): "upload" | "remove" | null {
  if (current && isLocalVideo(current)) return "upload";
  if (saved && !current) return "remove";
  return null;
}

/** Camera-roll order: photos in listing order (cover first), the video last. */
export function cameraRollItems(
  imageUris: string[],
  videoUri?: string | null,
): { uri: string; kind: "photo" | "video" }[] {
  const items: { uri: string; kind: "photo" | "video" }[] = imageUris.map((uri) => ({ uri, kind: "photo" }));
  if (videoUri) items.push({ uri: videoUri, kind: "video" });
  return items;
}

export function saveMediaLabel(hasVideo: boolean, saving: boolean): string {
  if (saving) return hasVideo ? "Saving Photos & Video..." : "Saving Photos...";
  return hasVideo ? "Save Photos & Video" : "Save Photos to Device";
}

export function manageMediaLabel(hasVideo: boolean): string {
  return hasVideo ? "Manage Photos & Video" : "Manage Photos";
}

/** Rows for the compact "Ready for Marketplace" hint on the preview. */
export function marketplaceHintRows(
  photoCount: number,
  video: ListingVideo | null | undefined,
): { label: string; text: string }[] {
  if (photoCount <= 0 && !video) return [];
  const rows = [{ label: "Photos", text: MARKETPLACE_PHOTOS_HINT(photoCount) }];
  if (video) rows.push({ label: "Video", text: MARKETPLACE_VIDEO_HINT });
  return rows;
}
