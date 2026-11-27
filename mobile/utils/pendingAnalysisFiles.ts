import { Directory, File, Paths } from "expo-file-system";

const PENDING_ANALYSIS_DIRECTORY = "pending-analysis";

function operationDirectory(operationId: string): Directory {
  return new Directory(Paths.document, PENDING_ANALYSIS_DIRECTORY, operationId);
}

function safeExtension(source: File): string {
  const extension = source.extension.toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(extension) ? extension : ".jpg";
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

export async function deletePendingAnalysisImages(operationId: string): Promise<void> {
  try {
    const directory = operationDirectory(operationId);
    if (directory.exists) directory.delete();
  } catch {
    // Local cleanup must not trap a user in a completed, expired, or discarded
    // operation. A later app uninstall also removes the app-owned directory.
  }
}
