import type { NotionSyncStatus, SavedListing, ListingWorkspaceState } from "../types/listing";
import { normalizeListingCondition } from "./descriptionFormatter";
import { notionSyncPresentation } from "./notionSyncState";

export interface ReviewListingPrices {
  activePriceNumber: number;
  highAskPriceNumber: number;
  priceMinNumber: number;
}

export interface DescriptionPreview {
  isDescriptionLong: boolean;
  descriptionToShow: string;
}

export interface BackendListingSavePayload {
  title: string;
  description: string;
  category: string;
  condition: string;
  asking_price: number;
}

export function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return `$${Math.round(value)}`;
}

export function deriveReviewListingPrices(listing: ListingWorkspaceState): ReviewListingPrices {
  const activePriceNumber = listing.activePrice || 0;
  return {
    activePriceNumber,
    highAskPriceNumber:
      listing.priceSuggestion?.high_ask_price ||
      listing.priceSuggestion?.max ||
      activePriceNumber,
    priceMinNumber:
      listing.priceSuggestion?.fast_sale_price ||
      listing.priceSuggestion?.min ||
      activePriceNumber,
  };
}

export function buildSavedListing(
  listing: ListingWorkspaceState,
  now: string
): SavedListing | null {
  if (!listing.itemId) return null;

  const prices = deriveReviewListingPrices(listing);
  return {
    id: listing.savedId || `local-${listing.itemId}`,
    itemId: listing.itemId,
    imageUri: listing.imageUris[0],
    imageUris: listing.imageUris,
    video: listing.video ?? null,
    title: listing.title,
    description: listing.description,
    category: listing.category,
    activePrice: prices.activePriceNumber,
    activePriceSource: listing.activePriceSource ?? "ai_recommended",
    priceMin: prices.priceMinNumber,
    priceMax: prices.highAskPriceNumber,
    priceSuggestion: listing.priceSuggestion ?? undefined,
    condition: normalizeListingCondition(listing.condition) || listing.condition,
    listingQuality: listing.listingQuality ?? undefined,
    status: "saved",
    createdAt: now,
    updatedAt: now,
  };
}

export function buildBackendListingSavePayload(
  listing: ListingWorkspaceState
): BackendListingSavePayload {
  return {
    title: listing.title,
    description: listing.description,
    category: listing.category,
    condition: normalizeListingCondition(listing.condition) || listing.condition,
    asking_price: deriveReviewListingPrices(listing).activePriceNumber,
  };
}

export function listingShareText(listing: Pick<ListingWorkspaceState, "title" | "description">): string {
  return `${listing.title}\n\n${listing.description}`;
}

export function descriptionPreview(
  description: string,
  expanded: boolean,
  limit = 200
): DescriptionPreview {
  const isDescriptionLong = description.length > limit;
  return {
    isDescriptionLong,
    descriptionToShow:
      expanded || !isDescriptionLong
        ? description
        : `${description.substring(0, limit)}...`,
  };
}

export function saveSuccessMessage(input: {
  backendSaveError: Error | null;
  notionSyncStatus: NotionSyncStatus;
}): string {
  if (input.backendSaveError) {
    return "Listing saved locally. Backend save failed, so the server copy may be out of date.";
  }
  if (input.notionSyncStatus.status === "failed") {
    return `Listing saved to your inventory. ${notionSyncPresentation(input.notionSyncStatus).message}`;
  }
  if (input.notionSyncStatus.status === "not_synced") {
    return `Listing saved to your inventory. ${notionSyncPresentation(input.notionSyncStatus).message}`;
  }
  return "Listing saved to your inventory.";
}
