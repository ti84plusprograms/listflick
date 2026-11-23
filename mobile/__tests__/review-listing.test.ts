import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSavedListing,
  buildBackendListingSavePayload,
  deriveReviewListingPrices,
  listingShareText,
  descriptionPreview,
} from "../utils/reviewListing";
import type { ListingWorkspaceState } from "../types/listing";
import { savedListingToWorkspace } from "../utils/listingWorkspace";

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function deepEqual<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const mockListing: any = {
  itemId: "test-item-123",
  savedId: "local-test-item-123",
  title: "Test Listing",
  description: "Test description that is a bit short.",
  category: "Electronics",
  condition: "like new",
  imageUris: ["uri1", "uri2"],
  activePrice: 50,
  activePriceSource: "manual",
  priceSuggestion: {
    min: 40,
    max: 60,
    fast_sale_price: 35,
    high_ask_price: 65,
    confidence: "high"
  },
  listingQuality: "high",
  images: [],
  saving: false,
};

// 1. saved listing creation preserves ids, images, price suggestion, condition normalization, and timestamps
const now = "2026-06-11T00:00:00.000Z";
const savedListing = buildSavedListing(mockListing, now);
if (!savedListing) throw new Error("Expected saved listing to be built");

equal(savedListing.id, "local-test-item-123", "preserves savedId");
equal(savedListing.itemId, "test-item-123", "preserves itemId");
equal(savedListing.imageUri, "uri1", "sets primary imageUri");
deepEqual(savedListing.imageUris, ["uri1", "uri2"], "preserves imageUris");
deepEqual(savedListing.priceSuggestion, mockListing.priceSuggestion, "preserves price suggestion");
equal(savedListing.condition, "Like New", "normalizes condition");
equal(savedListing.createdAt, now, "sets createdAt timestamp");
equal(savedListing.updatedAt, now, "sets updatedAt timestamp");

const workspaceFromSaved = savedListingToWorkspace(savedListing);
equal(workspaceFromSaved.savedId, savedListing.id, "saved-listing navigation preserves the local id");
equal(workspaceFromSaved.itemId, savedListing.itemId, "saved-listing navigation preserves the backend id");
deepEqual(workspaceFromSaved.imageUris, savedListing.imageUris, "saved-listing navigation preserves all images");

// 2. backend payload uses normalized condition and active price
const payload = buildBackendListingSavePayload(mockListing);
equal(payload.condition, "Like New", "backend payload uses normalized condition");
equal(payload.asking_price, 50, "backend payload uses active price");

// 3. display price fallback uses active price, fast/min, and high/max consistently
const pricesWithSuggestion = deriveReviewListingPrices(mockListing);
equal(pricesWithSuggestion.activePriceNumber, 50, "derives active price");
equal(pricesWithSuggestion.highAskPriceNumber, 65, "derives high ask price from high_ask_price");
equal(pricesWithSuggestion.priceMinNumber, 35, "derives min price from fast_sale_price");

const mockListingNoSuggestion: any = {
  title: "Test",
  description: "",
  category: "Electronics",
  condition: "good",
  imageUris: [],
  images: [],
  saving: false,
  activePrice: 20
};
const pricesNoSuggestion = deriveReviewListingPrices(mockListingNoSuggestion);
equal(pricesNoSuggestion.activePriceNumber, 20, "fallback active price");
equal(pricesNoSuggestion.highAskPriceNumber, 20, "fallback high ask price to active price");
equal(pricesNoSuggestion.priceMinNumber, 20, "fallback min price to active price");

const mockListingPartialSuggestion: any = {
  title: "Test",
  description: "",
  category: "Electronics",
  condition: "good",
  imageUris: [],
  images: [],
  saving: false,
  activePrice: 30,
  priceSuggestion: { min: 25, max: 35, confidence: "low" }
};
const pricesPartialSuggestion = deriveReviewListingPrices(mockListingPartialSuggestion);
equal(pricesPartialSuggestion.highAskPriceNumber, 35, "derives high ask from max if high_ask_price is missing");
equal(pricesPartialSuggestion.priceMinNumber, 25, "derives min from min if fast_sale_price is missing");

// 4. copy/share text is title + blank line + description
const shareText = listingShareText({ title: "My Title", description: "My Description" });
equal(shareText, "My Title\n\nMy Description", "formats copy/share text");

// 5. long descriptions truncate at 200 chars with ellipsis and expanded state shows full text
const longDescription = "A".repeat(300);
const previewCollapsed = descriptionPreview(longDescription, false);
equal(previewCollapsed.isDescriptionLong, true, "detects long description");
equal(previewCollapsed.descriptionToShow.length, 203, "truncates at 200 + '...'");
equal(previewCollapsed.descriptionToShow.endsWith("..."), true, "adds ellipsis");

const previewExpanded = descriptionPreview(longDescription, true);
equal(previewExpanded.isDescriptionLong, true, "still detects long description when expanded");
equal(previewExpanded.descriptionToShow, longDescription, "shows full text when expanded");

const shortDescription = "Short";
const previewShort = descriptionPreview(shortDescription, false);
equal(previewShort.isDescriptionLong, false, "detects short description");
equal(previewShort.descriptionToShow, "Short", "does not truncate short description");

// 6. save-photo flows request only the photo permission declared by the native manifest
const photoPermissionRequest = /MediaLibrary\.requestPermissionsAsync\(\s*true,\s*\["photo"\]\s*\)/;
for (const sourcePath of ["../app/review.tsx", "../hooks/useReviewListing.ts"]) {
  const source = readFileSync(resolve(__dirname, sourcePath), "utf8");
  equal(photoPermissionRequest.test(source), true, `${sourcePath} requests add-only photo permission`);
  equal(
    source.includes("MediaLibrary.requestPermissionsAsync()"),
    false,
    `${sourcePath} does not request every media permission`,
  );
}

// 7. save-photo flows maintain busy state and offer retry-only-failed-images
for (const sourcePath of ["../app/review.tsx", "../hooks/useReviewListing.ts"]) {
  const source = readFileSync(resolve(__dirname, sourcePath), "utf8");
  equal(source.includes("savingPhotos"), true, `${sourcePath} maintains savingPhotos busy state`);
  equal(source.includes("if (savingPhotos) return"), true, `${sourcePath} prevents duplicate save taps`);
  equal(source.includes('"Try Again"'), true, `${sourcePath} offers Try Again on partial/failed saves`);
  equal(
    source.includes("invalidateAuthenticatedImageUri(urisToSave[failure.index])"),
    true,
    `${sourcePath} invalidates failed protected-image resolutions before retry`,
  );
  equal(
    source.includes("failedUris = result.failures.map"),
    true,
    `${sourcePath} isolates failed URIs for safe retry without duplicating saved photos`,
  );
}

const reviewScreenSource = readFileSync(resolve(__dirname, "../app/review.tsx"), "utf8");
equal(
  reviewScreenSource.includes("setSavingPhotos(true);\n    try"),
  true,
  "review screen keeps the overflow progress indicator mounted while saving",
);
equal(
  reviewScreenSource.includes('{savingPhotos ? "Saving Photos..." : "Listing Preview"}'),
  true,
  "review screen also exposes save progress outside the overflow menu",
);
equal(
  reviewScreenSource.includes("if (!savingPhotos) setShowOverflow(false)"),
  true,
  "review screen prevents dismissing the only visible progress indicator during a save",
);
equal(
  reviewScreenSource.includes("disabled={saving || savingPhotos}"),
  true,
  "review screen prevents other overflow actions from hiding progress while photos save",
);

console.log("Review listing tests passed.");
