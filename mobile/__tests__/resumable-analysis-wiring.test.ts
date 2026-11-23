import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const api = readFileSync(resolve(__dirname, "../services/api.ts"), "utf8");
const camera = readFileSync(resolve(__dirname, "../app/camera.tsx"), "utf8");
const processing = readFileSync(resolve(__dirname, "../app/processing.tsx"), "utf8");
const storage = readFileSync(resolve(__dirname, "../services/storage.ts"), "utf8");
const review = readFileSync(resolve(__dirname, "../app/review.tsx"), "utf8");
const reviewHook = readFileSync(resolve(__dirname, "../hooks/useReviewListing.ts"), "utf8");
const pendingFiles = readFileSync(resolve(__dirname, "../utils/pendingAnalysisFiles.ts"), "utf8");
const home = readFileSync(resolve(__dirname, "../app/(tabs)/index.tsx"), "utf8");

for (const [source, expected] of [
  [api, '"Idempotency-Key": idempotencyKey'],
  [api, "startOrResumeAnalysis"],
  [api, "getAnalysisJobStatus"],
  [api, "analysis-jobs"],
  [camera, "savePendingAnalysisOperation({"],
  [camera, "persistPendingAnalysisImages(operation.operationId, uris)"],
  [camera, "imageUris: durableImageUris"],
  [camera, "if (operationId) await deletePendingAnalysisImages(operationId)"],
  [camera, "operationId: operation.operationId"],
  [camera, "const pending = await getPendingAnalysisOperation()"],
  [processing, "getPendingAnalysisOperation()"],
  [processing, "const stableOperationId = operation.operationId"],
  [processing, "uploadImages(uris, stableOperationId)"],
  [processing, "getItem(operation.itemId!)"],
  [processing, "getAnalysisJobStatus(operation.itemId!)"],
  [processing, 'job.status === "retryable_failed"'],
  [processing, "clearPendingAnalysisOperation(operation.operationId)"],
  [storage, "scopedStorageKey(PENDING_ANALYSIS_KEY, userId)"],
  [storage, "deletePendingAnalysisImages"],
  [storage, "clearPendingAnalysisOperationForItem"],
  [storage, "if (pendingOperation) await deletePendingAnalysisImages(pendingOperation.operationId)"],
  [review, "await clearPendingAnalysisOperationForItem(listing.itemId)"],
  [review, "hydrateWorkspace(savedListingToWorkspace(saved))"],
  [review, "await discardPendingItem(listing.itemId!)"],
  [reviewHook, "await clearPendingAnalysisOperationForItem(listing.itemId)"],
  [reviewHook, "hydrateWorkspace(savedListingToWorkspace(saved))"],
  [reviewHook, "resolveImageUri(uri, listing.itemId, index)"],
  [pendingFiles, "new Directory(Paths.document"],
  [pendingFiles, "source.copy(destination)"],
  [home, "Resume listing"],
  [home, "!pendingOperation &&"],
] as const) {
  if (!source.includes(expected)) {
    throw new Error(`Resumable analysis wiring is missing ${JSON.stringify(expected)}`);
  }
}

if (processing.includes("analyzeItem(uploadResult.item_id)")) {
  throw new Error("Processing still uses the non-resumable synchronous analysis call");
}

if (/result = await getItem\(operation\.itemId!\);\s*\}\s*if \(cancelled/.test(processing)) {
  throw new Error("Processing repeatedly polls the expensive full item endpoint");
}

if (
  processing.includes(
    'await persist({ phase: "completed" });\n        await clearPendingAnalysisOperation(operation.operationId)'
  )
) {
  throw new Error("Processing deletes recovery photos before the review draft is durable");
}

console.log("Resumable analysis wiring tests passed.");
