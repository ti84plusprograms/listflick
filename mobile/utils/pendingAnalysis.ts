export const PENDING_ANALYSIS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingAnalysisPhase =
  | "selected"
  | "uploading"
  | "uploaded"
  | "processing"
  | "retryable_failed"
  | "terminal_failed"
  | "completed";

export type PendingAnalysisOperation = {
  operationId: string;
  phase: PendingAnalysisPhase;
  imageUris: string[];
  itemId?: string;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

function fallbackOperationId(now: number, random: number): string {
  return `op-${now.toString(36)}-${random.toString(36).slice(2, 14)}`;
}

export function createPendingAnalysisOperation(
  imageUris: string[],
  options: { now?: number; random?: number; operationId?: string } = {}
): PendingAnalysisOperation {
  const now = options.now ?? Date.now();
  const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
  const operationId = options.operationId
    ?? cryptoObject?.randomUUID?.()
    ?? fallbackOperationId(now, options.random ?? Math.random());
  const timestamp = new Date(now).toISOString();
  return {
    operationId,
    phase: "selected",
    imageUris: [...imageUris],
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: new Date(now + PENDING_ANALYSIS_RETENTION_MS).toISOString(),
  };
}

export function updatePendingAnalysisOperation(
  operation: PendingAnalysisOperation,
  update: Partial<Pick<PendingAnalysisOperation, "phase" | "itemId" | "lastErrorCode">>,
  now: number = Date.now()
): PendingAnalysisOperation {
  return {
    ...operation,
    ...update,
    updatedAt: new Date(now).toISOString(),
  };
}

export function parsePendingAnalysisOperation(raw: string | null): PendingAnalysisOperation | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingAnalysisOperation>;
    if (
      typeof value.operationId !== "string"
      || !Array.isArray(value.imageUris)
      || value.imageUris.some((uri) => typeof uri !== "string")
      || typeof value.phase !== "string"
      || typeof value.createdAt !== "string"
      || typeof value.updatedAt !== "string"
      || typeof value.expiresAt !== "string"
    ) {
      return null;
    }
    return value as PendingAnalysisOperation;
  } catch {
    return null;
  }
}

export function isPendingAnalysisExpired(
  operation: PendingAnalysisOperation,
  now: number = Date.now()
): boolean {
  const expiresAt = Date.parse(operation.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

// Photos are copied to `<Documents>/pending-analysis/<operationId>/<file>` and
// stored as absolute URIs. iOS moves the app's data container to a new path on
// every update or reinstall, so a stored URI can name a container that no
// longer exists. Rebase it onto the current document directory on read.
const PENDING_ANALYSIS_PATH_PATTERN = /\/pending-analysis\/([^/?#]+\/[^/?#]+)$/;

export function rebasePendingAnalysisImageUri(uri: string, documentDirectoryUri: string): string {
  if (!uri.startsWith("file://")) return uri;
  const match = PENDING_ANALYSIS_PATH_PATTERN.exec(uri);
  if (!match) return uri;
  const base = documentDirectoryUri.endsWith("/") ? documentDirectoryUri : `${documentDirectoryUri}/`;
  return `${base}pending-analysis/${match[1]}`;
}

export function rebasePendingAnalysisOperation(
  operation: PendingAnalysisOperation,
  documentDirectoryUri: string
): PendingAnalysisOperation {
  return {
    ...operation,
    imageUris: operation.imageUris.map((uri) => rebasePendingAnalysisImageUri(uri, documentDirectoryUri)),
  };
}

export const MISSING_PENDING_PHOTOS_MESSAGE =
  "The photos for this listing are no longer on this device. Discard it and take the photos again.";

// React Native's networking never settles a multipart fetch whose file part is
// missing, so the user would wait for the request timeout and see a misleading
// server error. Check local files first and fail with a clear message.
export function assertPendingPhotosAvailable(
  uris: string[],
  fileExists: (uri: string) => boolean
): void {
  if (uris.some((uri) => uri.startsWith("file://") && !fileExists(uri))) {
    throw new Error(MISSING_PENDING_PHOTOS_MESSAGE);
  }
}
