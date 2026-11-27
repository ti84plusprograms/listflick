import {
  MISSING_PENDING_PHOTOS_MESSAGE,
  PENDING_ANALYSIS_RETENTION_MS,
  assertPendingPhotosAvailable,
  createPendingAnalysisOperation,
  isPendingAnalysisExpired,
  parsePendingAnalysisOperation,
  rebasePendingAnalysisImageUri,
  rebasePendingAnalysisOperation,
  updatePendingAnalysisOperation,
} from "../utils/pendingAnalysis";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const created = createPendingAnalysisOperation(
  ["file:///front.jpg", "file:///side.jpg"],
  { now: 1_000, operationId: "operation-test-1" }
);

assert(created.operationId === "operation-test-1", "operation IDs must remain stable across retries");
assert(created.phase === "selected", "new operations start before upload");
assert(created.imageUris.length === 2, "all selected images must be persisted");
assert(
  Date.parse(created.expiresAt) - Date.parse(created.createdAt) === PENDING_ANALYSIS_RETENTION_MS,
  "pending operations use the documented seven-day resume window"
);

const uploaded = updatePendingAnalysisOperation(
  created,
  { phase: "uploaded", itemId: "item-1" },
  2_000
);
assert(uploaded.operationId === created.operationId, "phase updates must not replace the idempotency key");
assert(uploaded.itemId === "item-1", "the server item ID must survive app restarts");
assert(uploaded.updatedAt !== created.updatedAt, "phase updates must advance the timestamp");

const parsed = parsePendingAnalysisOperation(JSON.stringify(uploaded));
assert(parsed?.itemId === "item-1", "persisted operations must round-trip");
const completed = updatePendingAnalysisOperation(uploaded, { phase: "completed" }, 3_000);
assert(completed.itemId === "item-1", "completed operations retain the durable server pointer");
assert(completed.imageUris[0] === created.imageUris[0], "completed operations retain review photos");
assert(parsePendingAnalysisOperation("not-json") === null, "corrupt storage must fail closed");
assert(isPendingAnalysisExpired(uploaded, Date.parse(uploaded.expiresAt) - 1) === false, "active operations remain resumable");
assert(isPendingAnalysisExpired(uploaded, Date.parse(uploaded.expiresAt)) === true, "expired operations stop resuming");

// iOS moves the app data container to a new UUID path on every update or
// reinstall, so stored absolute photo URIs must be rebased onto the current
// document directory when the operation is read back.
const oldContainerUri =
  "file:///var/mobile/Containers/Data/Application/36DB4CE2-1111-2222-3333-444455556666/Documents/pending-analysis/op-a/1.jpg";
const currentDocumentUri =
  "file:///var/mobile/Containers/Data/Application/A8317AA4-7777-8888-9999-AAAABBBBCCCC/Documents/";
const currentDocumentUriNoSlash = currentDocumentUri.slice(0, -1);
const expectedRebased = `${currentDocumentUri}pending-analysis/op-a/1.jpg`;

assert(
  rebasePendingAnalysisImageUri(oldContainerUri, currentDocumentUri) === expectedRebased,
  "photos saved under an old app container must resolve against the current document directory"
);
assert(
  rebasePendingAnalysisImageUri(oldContainerUri, currentDocumentUriNoSlash) === expectedRebased,
  "document directory URIs with and without a trailing slash must rebase identically"
);
assert(
  rebasePendingAnalysisImageUri(expectedRebased, currentDocumentUri) === expectedRebased,
  "an already-current photo URI must be unchanged"
);
assert(
  rebasePendingAnalysisImageUri(expectedRebased, currentDocumentUriNoSlash) === expectedRebased,
  "rebasing must be idempotent regardless of the trailing slash"
);
assert(
  rebasePendingAnalysisImageUri("ph://ABC-123/L0/001", currentDocumentUri) === "ph://ABC-123/L0/001",
  "photo library URIs must pass through unchanged"
);
const outsidePendingUri =
  "file:///var/mobile/Containers/Data/Application/36DB4CE2-1111-2222-3333-444455556666/Library/Caches/ImagePicker/photo.jpg";
assert(
  rebasePendingAnalysisImageUri(outsidePendingUri, currentDocumentUri) === outsidePendingUri,
  "file URIs outside pending-analysis must pass through unchanged"
);

const staleOperation = createPendingAnalysisOperation(
  [oldContainerUri, "ph://ABC-123/L0/001"],
  { now: 1_000, operationId: "op-a" }
);
const rebasedOperation = rebasePendingAnalysisOperation(staleOperation, currentDocumentUri);
assert(rebasedOperation.imageUris[0] === expectedRebased, "operations read back rebase every stored photo URI");
assert(rebasedOperation.imageUris[1] === "ph://ABC-123/L0/001", "operation rebasing leaves other URIs alone");
assert(rebasedOperation.operationId === "op-a", "rebasing must not change the idempotency key");
assert(staleOperation.imageUris[0] === oldContainerUri, "rebasing must not mutate the stored operation");

// A missing local photo must fail immediately with a clear, non-network
// message instead of reaching fetch and hanging until the request timeout.
let fetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  fetchCalls += 1;
  throw new Error("fetch must not be called when a photo is missing");
}) as typeof fetch;
try {
  let missingError: unknown;
  try {
    assertPendingPhotosAvailable(
      [expectedRebased, "ph://ABC-123/L0/001"],
      (uri) => uri !== expectedRebased
    );
  } catch (error) {
    missingError = error;
  }
  assert(missingError instanceof Error, "a missing local photo must throw before upload");
  assert(
    missingError.message === MISSING_PENDING_PHOTOS_MESSAGE,
    "a missing local photo must use the clear missing-photos message"
  );
  assert(
    !/server|connection|network|timed out/i.test(missingError.message),
    "the missing-photos message must not blame the server or the connection"
  );
  assert(fetchCalls === 0, "a missing local photo must not start a network request");

  const checked: string[] = [];
  assertPendingPhotosAvailable(
    [expectedRebased, "ph://ABC-123/L0/001"],
    (uri) => {
      checked.push(uri);
      return true;
    }
  );
  assert(
    checked.length === 1 && checked[0] === expectedRebased,
    "only local file URIs are checked for existence"
  );
} finally {
  globalThis.fetch = originalFetch;
}
assert(
  MISSING_PENDING_PHOTOS_MESSAGE
    === "The photos for this listing are no longer on this device. Discard it and take the photos again.",
  "the missing-photos message must tell the user how to recover"
);

console.log("Pending analysis state tests passed.");
