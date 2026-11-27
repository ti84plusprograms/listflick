import type {
  ActivePriceSource,
  ChecklistItem,
  DraftListingEdits,
  ImageQualityFeedback,
  ListingQuality,
  ListingVideo,
  ListingWorkspaceState,
  PriceSuggestion,
  SavedListing,
} from "@/types/listing";
import { normalizeListingCondition } from "./descriptionFormatter";

export type ListingWorkspaceParams = {
  itemId?: string;
  savedId?: string;
  imageUri?: string;
  imageUris?: string;
  /** JSON ListingVideo. */
  video?: string;
  title?: string;
  description?: string;
  category?: string;
  condition?: string;
  activePrice?: string;
  activePriceSource?: string;
  priceMin?: string;
  priceMax?: string;
  recommendedPrice?: string;
  priceSuggestion?: string;
  listingQuality?: string;
  checklist?: string;
  imageQualityFeedback?: string;
  notionPageId?: string;
  notionPageUrl?: string;
  lastSyncedSnapshot?: string;
};

function parseJsonArray<T>(value: string | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

function numberParam(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseListingVideo(value: string | undefined): ListingVideo | null {
  const video = parseJsonObject<ListingVideo>(value);
  if (!video || typeof video.uri !== "string" || !video.uri) return null;
  return { ...video, durationSeconds: Number(video.durationSeconds) || 0 };
}

export function parseListingWorkspaceParams(params: ListingWorkspaceParams): ListingWorkspaceState {
  const imageUris = parseJsonArray<string>(params.imageUris).filter((uri) => typeof uri === "string" && uri.length > 0);
  if (imageUris.length === 0 && params.imageUri) {
    imageUris.push(params.imageUri);
  }

  const priceSuggestion = parseJsonObject<PriceSuggestion>(params.priceSuggestion);
  const activePrice =
    numberParam(params.activePrice) ||
    priceSuggestion?.recommended_price ||
    numberParam(params.recommendedPrice) ||
    numberParam(params.priceMax) ||
    numberParam(params.priceMin);

  return {
    itemId: params.itemId,
    savedId: params.savedId,
    imageUri: params.imageUri,
    imageUris,
    title: params.title ?? "",
    description: params.description ?? "",
    category: params.category ?? "",
    condition: normalizeListingCondition(params.condition) || (params.condition ?? ""),
    activePrice,
    activePriceSource: isActivePriceSource(params.activePriceSource)
      ? params.activePriceSource
      : undefined,
    priceSuggestion,
    listingQuality: parseJsonObject<ListingQuality>(params.listingQuality),
    missingChecklist: parseJsonArray<ChecklistItem>(params.checklist),
    imageQualityFeedback: parseJsonArray<ImageQualityFeedback>(params.imageQualityFeedback),
    video: parseListingVideo(params.video),
  };
}

export function applyDraftListingEdits(
  listing: ListingWorkspaceState,
  draft: DraftListingEdits | null
): ListingWorkspaceState {
  if (!draft) return listing;

  const imageUris = draft.imageUris ?? listing.imageUris;
  return {
    ...listing,
    imageUris,
    imageUri: imageUris[0] ?? listing.imageUri,
    imageQualityFeedback: draft.imageQualityFeedback ?? listing.imageQualityFeedback,
    video: draft.video !== undefined ? draft.video : listing.video,
    title: draft.title ?? listing.title,
    description: draft.description ?? listing.description,
    category: draft.category ?? listing.category,
    condition: normalizeListingCondition(draft.condition, draft.flaws) || (draft.condition ?? listing.condition),
    activePrice: typeof draft.activePrice === "number" ? draft.activePrice : listing.activePrice,
    activePriceSource: draft.activePriceSource ?? listing.activePriceSource,
    priceSuggestion: draft.priceSuggestion ?? listing.priceSuggestion,
  };
}

export function savedListingToWorkspace(listing: SavedListing): ListingWorkspaceState {
  return {
    itemId: listing.itemId,
    savedId: listing.id,
    imageUri: listing.imageUri,
    imageUris: listing.imageUris ?? (listing.imageUri ? [listing.imageUri] : []),
    video: listing.video ?? null,
    title: listing.title,
    description: listing.description,
    category: listing.category,
    condition: normalizeListingCondition(listing.condition) || listing.condition,
    activePrice: listing.activePrice ?? listing.priceSuggestion?.recommended_price ?? listing.priceMax ?? listing.priceMin ?? 0,
    activePriceSource: listing.activePriceSource,
    priceSuggestion: listing.priceSuggestion,
    listingQuality: listing.listingQuality,
    missingChecklist: listing.missingChecklist ?? [],
    imageQualityFeedback: listing.imageQualityFeedback ?? [],
  };
}

export function listingWorkspaceToParams(listing: ListingWorkspaceState): ListingWorkspaceParams {
  const priceSuggestion = listing.priceSuggestion ?? undefined;
  return {
    itemId: listing.itemId,
    savedId: listing.savedId,
    imageUri: listing.imageUri,
    imageUris: JSON.stringify(listing.imageUris),
    video: listing.video ? JSON.stringify(listing.video) : undefined,
    title: listing.title,
    description: listing.description,
    category: listing.category,
    condition: listing.condition,
    activePrice: String(listing.activePrice || 0),
    activePriceSource: listing.activePriceSource,
    priceMin: String(priceSuggestion?.fast_sale_price || priceSuggestion?.min || listing.activePrice || 0),
    priceMax: String(priceSuggestion?.high_ask_price || priceSuggestion?.max || listing.activePrice || 0),
    recommendedPrice: String(priceSuggestion?.recommended_price || listing.activePrice || 0),
    priceSuggestion: priceSuggestion ? JSON.stringify(priceSuggestion) : undefined,
    listingQuality: listing.listingQuality ? JSON.stringify(listing.listingQuality) : undefined,
    checklist: JSON.stringify(listing.missingChecklist),
    imageQualityFeedback: JSON.stringify(listing.imageQualityFeedback),
  };
}

export function isActivePriceSource(value: unknown): value is ActivePriceSource {
  return (
    value === "ai_fast_sale" ||
    value === "ai_recommended" ||
    value === "ai_high_ask" ||
    value === "manual"
  );
}
