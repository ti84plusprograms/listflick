import * as VideoThumbnails from "expo-video-thumbnails";

import { frameSampleTimes } from "../utils/listingVideo";

export type VideoFrame = { uri: string; time: number };

/**
 * Extract evenly spaced candidate frames from a local video for analysis. The backend
 * scores them (sharpness, darkness, how different they are) and keeps the best few,
 * so a frame that fails to extract is simply skipped.
 */
export async function extractVideoFrames(videoUri: string, durationSeconds: number): Promise<VideoFrame[]> {
  const frames: VideoFrame[] = [];
  for (const time of frameSampleTimes(durationSeconds)) {
    try {
      const thumbnail = await VideoThumbnails.getThumbnailAsync(videoUri, {
        time: Math.round(time * 1000),
        quality: 0.6,
      });
      frames.push({ uri: thumbnail.uri, time });
    } catch {
      // Some players cannot seek to every time (very short clips, variable frame rates).
    }
  }
  return frames;
}

/** One frame near the start, used as the tray thumbnail. */
export async function videoPosterUri(videoUri: string, durationSeconds: number): Promise<string | null> {
  try {
    const time = Math.min(Math.max(durationSeconds, 0) * 0.2, 1.5);
    const thumbnail = await VideoThumbnails.getThumbnailAsync(videoUri, { time: Math.round(time * 1000), quality: 0.5 });
    return thumbnail.uri;
  } catch {
    return null;
  }
}
