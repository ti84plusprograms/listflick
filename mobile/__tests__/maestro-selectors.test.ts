import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const expectedSelectors: Record<string, string[]> = {
  "app/(tabs)/index.tsx": ["home-screen", "home-data-ready", "home-new-listing"],
  "app/camera.tsx": ["camera-screen", "camera-next", "camera-open-library"],
  "components/camera/PhotoManager.tsx": ["selected-photo-count"],
  "app/processing.tsx": ["processing-screen", "processing-status"],
  "app/review.tsx": [
    "review-screen",
    "review-back",
    "review-listing-title",
    "review-listing-price",
    "review-listing-description",
    "review-save-to-inventory",
    "review-edit-listing",
    "review-more-actions",
    "review-discard-listing",
    "review-manage-photos",
    "review-save-photos",
  ],
  "app/edit-listing.tsx": [
    "edit-listing-screen",
    "edit-listing-title",
    "edit-listing-price",
    "edit-listing-brand-model",
    "edit-listing-save",
    "edit-listing-improvement-summary",
    "edit-listing-buyer-trust-suggestion",
    "edit-listing-apply-buyer-trust",
    "edit-listing-description-suggestion",
    "edit-listing-apply-description-details",
  ],
  "app/(tabs)/inventory.tsx": [
    "inventory-screen",
    "inventory-list",
    "inventory-open-listing",
    "inventory-remove-listing",
    "inventory-recently-deleted",
  ],
  "app/recently-deleted.tsx": ["recently-deleted-screen", "recently-deleted-back", "Permanently delete"],
  "app/(auth)/login.tsx": [
    "login-screen",
    "auth-email-input",
    "auth-password-input",
    "auth-submit-button",
    "auth-toggle-mode-button",
    "auth-error-message",
  ],
  "app/manage-photos.tsx": [
    "manage-photos-screen",
    "manage-photos-back",
    "manage-photos-add",
    "manage-photos-photo-${index + 1}",
    "manage-photos-remove-${index + 1}",
    "manage-photos-done",
  ],
  "components/managePhotos/PhotoViewer.tsx": [
    "photo-viewer",
    "photo-viewer-close",
    "photo-viewer-previous",
    "photo-viewer-next",
  ],
  "app/(tabs)/settings.tsx": [
    "settings-screen",
    "settings-ai-ready",
    "settings-ai-provider",
    "settings-provider-key",
    "settings-provider-selector",
    "settings-provider-${provider}",
    "settings-provider-key-modal",
    "settings-provider-key-close",
    "settings-provider-key-input",
    "settings-ai-photo-insights",
    "settings-sign-out-button",
  ],
};

for (const [path, selectors] of Object.entries(expectedSelectors)) {
  const source = readFileSync(resolve(root, path), "utf8");
  for (const selector of selectors) {
    if (!source.includes(selector)) {
      throw new Error(`${path} is missing Maestro selector ${selector}`);
    }
  }
}

const inventory = readFileSync(resolve(root, "app/(tabs)/inventory.tsx"), "utf8");
for (const expected of [
  'accessibilityLabel={`Open ${title} listing, ${price}, ${statusLabel(item)}`}',
  'accessibilityHint="Opens listing details"',
  'accessibilityLabel={`Remove ${title} from inventory`}',
] as const) {
  if (!inventory.includes(expected)) {
    throw new Error(`Inventory accessibility contract is missing ${expected}`);
  }
}
if (inventory.includes("accessible={false}")) {
  throw new Error("The inventory open-listing action must remain in the accessibility tree");
}

console.log("maestro selector contract checks passed");
