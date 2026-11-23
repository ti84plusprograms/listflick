import type {
  NotionCapability,
  NotionSyncErrorCode,
  NotionSyncStatus,
} from "../types/listing";
import type { HealthResponse } from "../types/api";

export type { NotionCapability };

export type EffectiveNotionReason =
  | NotionCapability["reason"]
  | "client_disabled"
  | "unavailable";

export interface EffectiveNotionCapability {
  effectiveRequestEnabled: boolean;
  canOverride: boolean;
  reason: EffectiveNotionReason;
}

export interface NotionSyncPresentation {
  title: string;
  message: string;
  canRetry: boolean;
  actionLabel?: string;
}

export function shouldShowNotionUi(
  isDevelopment: boolean,
  capability: NotionCapability | null,
): boolean {
  return isDevelopment && capability !== null;
}

export function notionCapabilityFromHealth(health: HealthResponse | null): NotionCapability | null {
  if (health?.notion_capability) return health.notion_capability;
  if (health?.notion_configured) {
    return {
      configured: true,
      creation_enabled: true,
      client_override_allowed: Boolean(health.notion_client_override_allowed),
      effective_request_enabled: true,
      reason: "configured",
    };
  }
  return null;
}

export function effectiveNotionCapability(
  capability: NotionCapability | null,
  clientEnabled: boolean,
): EffectiveNotionCapability {
  if (!capability) {
    return { effectiveRequestEnabled: false, canOverride: false, reason: "unavailable" };
  }
  if (!capability.configured) {
    return {
      effectiveRequestEnabled: false,
      canOverride: false,
      reason: capability.reason,
    };
  }
  if (capability.client_override_allowed && !clientEnabled) {
    return { effectiveRequestEnabled: false, canOverride: true, reason: "client_disabled" };
  }
  return {
    effectiveRequestEnabled: true,
    canOverride: capability.client_override_allowed,
    reason: "configured",
  };
}

export function notionCapabilitySubtitle(state: EffectiveNotionCapability): string {
  return {
    configured: state.canOverride
      ? "Backend connected; disable only to test skipped sync"
      : "Connected and controlled by the backend",
    client_disabled: "Backend connected; requests paused on this device",
    backend_disabled: "Disabled by the backend deployment",
    missing_credentials: "Backend credential or destination is missing",
    unavailable: "Could not check backend capability",
  }[state.reason];
}

export function notionSyncPresentation(
  status: NotionSyncStatus,
  capability?: NotionCapability | null,
): NotionSyncPresentation {
  if (status.status === "synced") {
    return { title: "Synced to Notion", message: "The Notion page is up to date.", canRetry: false };
  }
  if (status.status === "syncing") {
    return {
      title: "Syncing to Notion",
      message: "The listing is saved while Notion updates.",
      canRetry: true,
      actionLabel: "Check Again",
    };
  }
  if (status.status === "not_synced") {
    const isConfiguredNow = Boolean(capability?.configured || status.reason === "configured");
    const message = {
      client_disabled: "Notion was skipped by the development override.",
      backend_disabled: "Notion is disabled by the backend deployment.",
      missing_credentials: "The backend is missing a Notion credential or destination.",
      configured: "This listing has not been synced to Notion yet.",
    }[status.reason ?? "configured"];
    return {
      title: "Saved without Notion",
      message,
      canRetry: isConfiguredNow,
      actionLabel: "Sync to Notion",
    };
  }

  const code = status.error_code ?? "unknown";
  const configurationFailure = new Set<NotionSyncErrorCode>([
    "authorization",
    "schema",
    "not_found",
  ]).has(code);
  return {
    title: configurationFailure ? "Notion configuration problem" : "Notion needs attention",
    message: status.last_error ?? "Notion sync failed. The listing remains saved.",
    canRetry: true,
    actionLabel: "Try Again",
  };
}
