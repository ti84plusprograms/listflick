import {
  effectiveNotionCapability,
  notionCapabilityFromHealth,
  notionCapabilitySubtitle,
  notionSyncPresentation,
  shouldShowNotionUi,
} from "../utils/notionSyncState";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const configured = {
  configured: true,
  creation_enabled: true,
  client_override_allowed: true,
  effective_request_enabled: true,
  reason: "configured" as const,
};

deepEqual(shouldShowNotionUi(true, configured), true, "development exposes enabled Notion UI");
deepEqual(shouldShowNotionUi(false, configured), false, "release builds hide Notion UI");
deepEqual(
  shouldShowNotionUi(true, { ...configured, configured: false, creation_enabled: false, reason: "backend_disabled" }),
  true,
  "development exposes the backend-disabled reason",
);
deepEqual(shouldShowNotionUi(true, null), false, "unknown capability hides Notion UI");

deepEqual(
  effectiveNotionCapability(configured, true),
  { effectiveRequestEnabled: true, canOverride: true, reason: "configured" },
  "configured backend enables requests",
);
deepEqual(
  effectiveNotionCapability(configured, false),
  { effectiveRequestEnabled: false, canOverride: true, reason: "client_disabled" },
  "development override can pause a configured backend",
);
deepEqual(
  effectiveNotionCapability(
    { ...configured, configured: false, effective_request_enabled: false, reason: "backend_disabled" },
    true,
  ),
  { effectiveRequestEnabled: false, canOverride: false, reason: "backend_disabled" },
  "local on state cannot enable a disabled backend",
);

if (notionCapabilitySubtitle(effectiveNotionCapability(null, true)) !== "Could not check backend capability") {
  throw new Error("missing health must not claim Notion is enabled");
}

deepEqual(
  notionCapabilityFromHealth({
    status: "ok",
    notion_configured: true,
    notion_client_override_allowed: false,
  }),
  {
    configured: true,
    creation_enabled: true,
    client_override_allowed: false,
    effective_request_enabled: true,
    reason: "configured",
  },
  "legacy configured health remains supported",
);

deepEqual(
  notionSyncPresentation({ status: "syncing" }),
  { title: "Syncing to Notion", message: "The listing is saved while Notion updates.", canRetry: true, actionLabel: "Check Again" },
  "an in-flight or expired lease remains recoverable",
);
deepEqual(
  notionSyncPresentation({ status: "failed", error_code: "network", last_error: "Could not reach Notion." }),
  { title: "Notion needs attention", message: "Could not reach Notion.", canRetry: true, actionLabel: "Try Again" },
  "network failures are retryable",
);
deepEqual(
  notionSyncPresentation({ status: "failed", error_code: "authorization", last_error: "Not authorized." }),
  { title: "Notion configuration problem", message: "Not authorized.", canRetry: true, actionLabel: "Try Again" },
  "authorization failures remain retryable after configuration is fixed",
);
deepEqual(
  notionSyncPresentation({ status: "not_synced", reason: "backend_disabled" }),
  { title: "Saved without Notion", message: "Notion is disabled by the backend deployment.", canRetry: false, actionLabel: "Sync to Notion" },
  "backend-disabled saves remain explicit when backend is unconfigured",
);
deepEqual(
  notionSyncPresentation({ status: "not_synced", reason: "backend_disabled" }, configured),
  { title: "Saved without Notion", message: "Notion is disabled by the backend deployment.", canRetry: true, actionLabel: "Sync to Notion" },
  "not_synced saves become syncable once backend is configured",
);

const settingsSource = readFileSync(resolve(__dirname, "../app/(tabs)/settings.tsx"), "utf8");
const reviewSource = readFileSync(resolve(__dirname, "../app/review.tsx"), "utf8");
const apiSource = readFileSync(resolve(__dirname, "../services/api.ts"), "utf8");
for (const expected of [
  "getHealth()",
  "Notion Request Override",
  "notionCapabilitySubtitle(effectiveNotion)",
  "disabled={!effectiveNotion.canOverride}",
  "showNotionDeveloperUi",
]) {
  if (!settingsSource.includes(expected)) {
    throw new Error(`Settings capability wiring is missing ${JSON.stringify(expected)}`);
  }
}
for (const expected of [
  "notionSyncPresentation",
  "handleRetryNotionSync",
  "Listing saved to your inventory.",
  "lastSyncedSnapshot: snapshotFromListing(listing)",
  'params.savedId ? "saved" : "unsaved"',
  'item.status === "saved"',
  "shouldShowNotionUi(__DEV__, notionCapability)",
  '!showNotionUi\n          ? "Listing saved to your inventory."',
]) {
  if (!reviewSource.includes(expected)) {
    throw new Error(`Review Notion status wiring is missing ${JSON.stringify(expected)}`);
  }
}
if (reviewSource.includes('storedItem?.status === "saved" || storedItem?.notionPageId')) {
  throw new Error("Inventory state must not depend on Notion page metadata");
}
if ((reviewSource.match(/Open in Notion/g) ?? []).length !== 1) {
  throw new Error("Review must expose exactly one Open in Notion action");
}
if (!apiSource.includes('requestJson("/health", "GET", "Could not check backend capability")')) {
  throw new Error("Mobile API client is missing the health capability request");
}

console.log("Notion capability and sync state tests passed.");
