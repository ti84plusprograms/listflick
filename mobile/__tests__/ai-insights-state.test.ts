import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ListingWorkspaceState } from "../types/listing";
import { applyDraftListingEdits } from "../utils/listingWorkspace";

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function excludes(value: string, unexpected: string, message: string): void {
  if (value.includes(unexpected)) {
    throw new Error(`${message}: found ${JSON.stringify(unexpected)}`);
  }
}

const priceSuggestion = {
  min: 80,
  max: 120,
  fast_sale_price: 80,
  recommended_price: 100,
  high_ask_price: 120,
  confidence: 0.9,
  pricing_reason: "Comparable listings",
};

const listing: ListingWorkspaceState = {
  imageUris: ["one.jpg"],
  title: "Chair",
  description: "Description",
  category: "Furniture",
  condition: "Good",
  activePrice: 100,
  activePriceSource: "ai_recommended",
  priceSuggestion,
  listingQuality: null,
  missingChecklist: [],
  imageQualityFeedback: [],
};

const updated = applyDraftListingEdits(listing, {
  activePrice: 92,
  activePriceSource: "manual",
  imageUris: ["two.jpg"],
});

equal(updated.activePrice, 92, "applies the active listing price");
equal(updated.activePriceSource, "manual", "tracks a manual price override");
equal(updated.priceSuggestion, priceSuggestion, "keeps AI price tiers separate from the active price");
equal(updated.imageUris[0], "two.jpg", "applies shared photo state");

const stateDirectory = resolve(__dirname, "../state");
const providerSource = [
  readFileSync(resolve(stateDirectory, "AIInsightsContext.tsx"), "utf8"),
  readFileSync(resolve(stateDirectory, "ListingWorkspaceContext.tsx"), "utf8"),
].join("\n");

excludes(providerSource, "services/api", "providers do not import API actions");
excludes(providerSource, "improveListing", "providers do not improve listings");
excludes(providerSource, "replaceItemImages", "providers do not replace images");

for (const screen of ["edit-listing.tsx", "manage-photos.tsx"]) {
  const source = readFileSync(resolve(__dirname, "../app", screen), "utf8");
  excludes(source, "getAIInsightsSettings", `${screen} reads the global toggle from context`);
}

console.log("AI Insights state architecture tests passed.");
