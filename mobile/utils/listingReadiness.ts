import type { ImageQualityFeedback, SavedListing, UserProfile } from "../types/listing";

/**
 * Shared "does this listing need attention?" rules. Home and Inventory both use
 * needsReason so their counts and badges always agree.
 */

export interface NeedsReason {
  text: string;
  tag?: string;
}

export interface OpenBuyerQuestion {
  question: string;
  affectsPrice: boolean;
}

export type InventoryFilter = "attention" | null;

type ListingLike = Pick<SavedListing, "title" | "description" | "priceMin" | "priceMax"> &
  Partial<Pick<SavedListing, "imageUri" | "imageUris" | "activePrice" | "priceSuggestion" | "imageQualityFeedback">>;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isAnswered(record: Record<string, unknown>): boolean {
  if (record.answered === true) return true;
  const status = clean(record.status).toLowerCase();
  if (status === "answered" || status === "complete" || status === "done") return true;
  return Boolean(clean(record.answer) || clean(record.seller_answer) || clean(record.sellerAnswer));
}

function toQuestion(value: unknown, affectsPrice: boolean): OpenBuyerQuestion | null {
  if (typeof value === "string") {
    return clean(value) ? { question: clean(value), affectsPrice } : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (isAnswered(record)) return null;
  const question = clean(record.question) || clean(record.text) || clean(record.prompt);
  if (!question) return null;
  const flag = record.affects_price ?? record.affectsPrice;
  return { question, affectsPrice: affectsPrice || flag === true };
}

/**
 * Unanswered buyer questions on a listing. The fields come from the analysis
 * (buyer_questions / price_question); older listings have neither, so every
 * shape is optional and unknown shapes are ignored.
 */
export function openBuyerQuestions(listing: unknown): OpenBuyerQuestion[] {
  if (!listing || typeof listing !== "object") return [];
  const record = listing as Record<string, unknown>;
  const questions: OpenBuyerQuestion[] = [];
  const add = (question: OpenBuyerQuestion | null) => {
    if (question && !questions.some((q) => q.question.toLowerCase() === question.question.toLowerCase())) {
      questions.push(question);
    }
  };
  add(toQuestion(record.priceQuestion ?? record.price_question, true));
  const list = record.buyerQuestions ?? record.buyer_questions;
  if (Array.isArray(list)) list.forEach((item) => add(toQuestion(item, false)));
  return questions;
}

export function listingPhotoUris(listing: Pick<SavedListing, "imageUri" | "imageUris">): string[] {
  if (listing.imageUris?.length) return listing.imageUris;
  return listing.imageUri ? [listing.imageUri] : [];
}

export function listingAskingPrice(listing: ListingLike): number {
  const candidates = [
    listing.activePrice,
    listing.priceSuggestion?.recommended_price,
    listing.priceMax,
    listing.priceMin,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

/** Photos whose quality feedback says retake. Matches the Manage Photos lookup. */
export function retakePhotoCount(photoCount: number, feedback: ImageQualityFeedback[] = []): number {
  let count = 0;
  for (let index = 0; index < photoCount; index += 1) {
    const entry = feedback.find((item) => item.image_index === index) ?? feedback[index];
    if (entry?.overall_status === "poor") count += 1;
  }
  return count;
}

export function needsReason(listing: ListingLike): NeedsReason | null {
  const question = openBuyerQuestions(listing)[0];
  if (question) return { text: question.question, tag: question.affectsPrice ? "Affects price" : undefined };
  if (!(listingAskingPrice(listing) > 0)) return { text: "Add a price" };
  if (!clean(listing.title)) return { text: "Add a title" };
  if (!clean(listing.description)) return { text: "Write a description" };
  const photos = listingPhotoUris(listing);
  if (!photos.length) return { text: "Add photos" };
  const retake = retakePhotoCount(photos.length, listing.imageQualityFeedback);
  if (retake) return { text: `Retake ${retake} photo${retake === 1 ? "" : "s"}` };
  return null;
}

export function statusLabel(listing: ListingLike): "Draft" | "Ready to list" {
  return needsReason(listing) ? "Draft" : "Ready to list";
}

export function formatListingPrice(value: number): string {
  if (!(value > 0)) return "";
  return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

export function sortByRecentlyUpdated<T extends Pick<SavedListing, "updatedAt">>(listings: T[]): T[] {
  return [...listings].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function homeSummary(listings: ListingLike[]): string | null {
  if (!listings.length) return null;
  const ready = listings.filter((listing) => !needsReason(listing)).length;
  const count = `${listings.length} listing${listings.length === 1 ? "" : "s"}`;
  return `${count} · ${ready ? `${ready} ready to post` : "not ready yet"}`;
}

export function savedWhen(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((day(now) - day(date)) / 86_400_000);
  if (diff <= 0) return "Saved today";
  if (diff === 1) return "Saved yesterday";
  return `Saved ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function listingMeta(parts: (string | undefined | null)[]): string {
  return parts.filter(Boolean).join(" · ");
}

export function isProfileSetupMissing(profile: Pick<UserProfile, "pickupLocation" | "paymentMethods"> | null): boolean {
  return !(clean(profile?.pickupLocation) && clean(profile?.paymentMethods));
}

export function filterInventoryListings<T extends ListingLike>(listings: T[], filter: InventoryFilter): T[] {
  return filter === "attention" ? listings.filter((listing) => needsReason(listing)) : listings;
}

export interface HomeAttentionEntry<T> {
  listing: T;
  reason: NeedsReason;
}

export interface HomeModel<T> {
  /** No listings and nothing unfinished: show the "Make your first listing" card. */
  isFirstRun: boolean;
  summary: string | null;
  attention: HomeAttentionEntry<T>[];
  ready: T[];
  setupMissing: boolean;
  /** Rows in "Needs attention": unfinished listings and listings. Setup is a separate pill. */
  attentionCount: number;
  caughtUp: boolean;
}

export const HOME_ROW_LIMIT = 3;

export function buildHomeModel<T extends ListingLike & Pick<SavedListing, "updatedAt">>(input: {
  listings: T[];
  /** Unfinished listings (photos taken, not saved yet). */
  pendingCount: number;
  profile: Pick<UserProfile, "pickupLocation" | "paymentMethods"> | null;
}): HomeModel<T> {
  const sorted = sortByRecentlyUpdated(input.listings);
  const attention: HomeAttentionEntry<T>[] = [];
  const ready: T[] = [];
  for (const listing of sorted) {
    const reason = needsReason(listing);
    if (reason) attention.push({ listing, reason });
    else ready.push(listing);
  }
  const isFirstRun = sorted.length === 0 && input.pendingCount === 0;
  const setupMissing = isProfileSetupMissing(input.profile);
  const attentionCount = attention.length + input.pendingCount;
  return {
    isFirstRun,
    summary: homeSummary(sorted),
    attention,
    ready,
    setupMissing,
    attentionCount,
    caughtUp: !isFirstRun && attentionCount === 0,
  };
}
