import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPendingAnalysisOperation,
  parsePendingAnalysisOperations,
  removePendingAnalysisOperation,
  upsertPendingAnalysisOperation,
} from "../utils/pendingAnalysis";
import { buildHomeModel } from "../utils/listingReadiness";

const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");

const first = createPendingAnalysisOperation(["file:///a.jpg"], { now: 1_000, operationId: "op-first" });
const second = createPendingAnalysisOperation(["file:///b.jpg"], { now: 2_000, operationId: "op-second" });

// Several unfinished listings are kept side by side, newest first.
let list = upsertPendingAnalysisOperation([], first);
list = upsertPendingAnalysisOperation(list, second);
deepEqual(list.map((op) => op.operationId), ["op-second", "op-first"], "both kept, newest first");

// Saving progress on one replaces only that one.
list = upsertPendingAnalysisOperation(list, { ...first, phase: "completed", itemId: "item-1" });
equal(list.length, 2, "upsert does not duplicate");
equal(list.find((op) => op.operationId === "op-first")?.phase, "completed", "progress saved");
equal(list.find((op) => op.operationId === "op-second")?.phase, "selected", "other draft untouched");

// Discarding or saving one leaves the others.
deepEqual(removePendingAnalysisOperation(list, "op-first").map((op) => op.operationId), ["op-second"], "remove one");
equal(removePendingAnalysisOperation(list, "missing").length, 2, "unknown id is a no-op");

// Stored lists parse; bad entries are dropped instead of losing every draft.
deepEqual(parsePendingAnalysisOperations(null), [], "nothing stored");
deepEqual(parsePendingAnalysisOperations("{broken"), [], "bad JSON");
deepEqual(
  parsePendingAnalysisOperations(JSON.stringify([first, { operationId: 3 }, second])).map((op) => op.operationId),
  ["op-second", "op-first"],
  "invalid entry dropped",
);

// Home: each unfinished listing counts toward Needs attention.
const profile = { pickupLocation: "Midtown", paymentMethods: "Cash" };
const twoDrafts = buildHomeModel({ listings: [], pendingCount: 2, profile });
equal(twoDrafts.isFirstRun, false, "drafts leave first run");
equal(twoDrafts.attentionCount, 2, "both drafts need attention");
equal(buildHomeModel({ listings: [], pendingCount: 0, profile }).isFirstRun, true, "no drafts is first run");

// Wiring.
const camera = read("../app/camera.tsx");
ok(!camera.includes("Listing already in progress"), "camera no longer blocks a second listing");
ok(!camera.includes("getPendingAnalysisOperation"), "camera does not check for an existing draft");

const processing = read("../app/processing.tsx");
equal((processing.match(/getPendingAnalysisOperation\(operationId\)/g) ?? []).length, 2, "processing loads and discards its own draft");

const home = read("../app/(tabs)/index.tsx");
ok(home.includes("getPendingAnalysisOperations()"), "Home loads every draft");
ok(home.includes("pendingOperations.forEach("), "Home shows a row per draft");
ok(home.includes("pendingCount: pendingOperations.length"), "Home counts every draft");

const storage = read("../services/storage.ts");
ok(storage.includes("LEGACY_PENDING_ANALYSIS_KEY"), "the old single draft is carried over");

console.log("multiple drafts tests passed");
