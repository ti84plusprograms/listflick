import { Directory, File, Paths } from "expo-file-system";

import type { PendingAnalysisVideo } from "./pendingAnalysis";

const PENDING_ANALYSIS_DIRECTORY = "pending-analysis";

function operationDirectory(operationId: string): Directory {
  return new Directory(Paths.document, PENDING_ANALYSIS_DIRECTORY, operationId);
}

function safeExtension(source: File, fallback = ".jpg"): string {
  const extension = source.extension.toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(extension) ? extension : fallback;
}

export async function persistPendingAnalysisImages(
  operationId: string,
  sourceUris: string[]
): Promise<string[]> {
  const directory = operationDirectory(operationId);
  try {
    if (directory.exists) directory.delete();
    directory.create({ idempotent: true, intermediates: true });

    const persistedUris: string[] = [];
    for (const [index, uri] of sourceUris.entries()) {
      const source = new File(uri);
      if (!source.exists) {
        throw new Error("A selected photo is no longer available.");
      }
      const destination = new File(directory, `${index + 1}${safeExtension(source)}`);
      await source.copy(destination);
      persistedUris.push(destination.uri);
    }
    return persistedUris;
  } catch (error) {
    if (directory.exists) directory.delete();
    throw error;
  }
}

/**
 * Copy the video and its candidate frames into the operation's directory (after the
 * photos, which reset that directory) so a resumed upload still has them.
 */
export async function persistPendingAnalysisVideo(
  operationId: string,
  video: PendingAnalysisVideo
): Promise<PendingAnalysisVideo> {
  const directory = operationDirectory(operationId);
  directory.create({ idempotent: true, intermediates: true });
  const source = new File(video.uri);
  if (!source.exists) {
    throw new Error("The selected video is no longer available.");
  }
  const destination = new File(directory, `video${safeExtension(source, ".mp4")}`);
  if (destination.exists) destination.delete();
  await source.copy(destination);

  const frames: PendingAnalysisVideo["frames"] = [];
  for (const [index, frame] of video.frames.entries()) {
    const frameSource = new File(frame.uri);
    if (!frameSource.exists) continue;
    const frameDestination = new File(directory, `frame-${index + 1}.jpg`);
    if (frameDestination.exists) frameDestination.delete();
    await frameSource.copy(frameDestination);
    frames.push({ uri: frameDestination.uri, time: frame.time });
  }
  return { ...video, uri: destination.uri, frames };
}

export async function deletePendingAnalysisImages(operationId: string): Promise<void> {
  try {
    const directory = operationDirectory(operationId);
    if (directory.exists) directory.delete();
  } catch {
    // Local cleanup must not trap a user in a completed, expired, or discarded
    // operation. A later app uninstall also removes the app-owned directory.
  }
}
