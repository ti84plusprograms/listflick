import {
  PENDING_ANALYSIS_RETENTION_MS,
  createPendingAnalysisOperation,
  isPendingAnalysisExpired,
  parsePendingAnalysisOperation,
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

console.log("Pending analysis state tests passed.");
