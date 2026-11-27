export interface PriceSuggestion {
  min: number;
  max: number;
  fast_sale_price: number;
  recommended_price: number;
  high_ask_price: number;
  confidence: number;
  pricing_reason: string;
  pricing_warnings?: string[];
}

export type ActivePriceSource = "ai_fast_sale" | "ai_recommended" | "ai_high_ask" | "manual";

export type ReadinessLabel = "needs_work" | "almost_ready" | "ready";

export interface ListingQuality {
  overall_score: number;
  readiness_label: ReadinessLabel;
  score_breakdown: Record<string, number>;
  improvement_suggestions: string[];
  /** Tips the seller has finished, by text. Kept with the listing by the live checklist. */
  completed_suggestions?: string[];
  /** Photo and text signatures the tips were last re-checked against. */
  checked_media?: string;
  checked_text?: string;
}

/** One unknown detail that would move the price by more than about 25%. */
export interface PriceQuestion {
  question: string;
  why: string;
  options: string[];
}

/** Something buyers of this kind of item always ask that the photos cannot answer. */
export interface BuyerQuestion {
  question: string;
  options: string[];
  affects_price: boolean;
}

export interface VisionAnalysis {
  item_name: string;
  brand: string;
  condition: string;
  category: string;
  confidence: number;
  detected_attributes: string[];
  visible_defects: string[];
  model?: string;
  variant?: string;
  identified_from?: string;
  identification_confidence?: number;
  standard_specs?: string[];
  price_question?: PriceQuestion | null;
  buyer_questions?: BuyerQuestion[];
  seller_facts?: string[];
}

export interface GeneratedListing {
  title: string;
  description: string;
  marketplace_category: string;
  tags: string[];
  price_suggestion: PriceSuggestion;
  listing_quality: ListingQuality;
  price_question?: PriceQuestion | null;
  buyer_questions?: BuyerQuestion[];
}

export type ImprovementAction =
  | "make_title_more_searchable"
  | "make_description_shorter"
  | "make_description_more_casual"
  | "make_description_more_professional"
  | "add_condition_details"
  | "improve_buyer_trust"
  | "make_price_more_competitive"
  | "generate_platform_ready_version";

export type ChecklistStatus = "missing" | "uncertain" | "complete";

export interface ChecklistItem {
  key: string;
  label: string;
  status: ChecklistStatus;
  reason?: string | null;
  suggested_question?: string | null;
}

export type ImageQualityStatus = "good" | "needs_improvement" | "poor";

export interface ImageQualityFeedback {
  image_id: string;
  image_index: number;
  overall_status: ImageQualityStatus;
  sharpness_status: ImageQualityStatus;
  brightness_status: ImageQualityStatus;
  contrast_status: ImageQualityStatus;
  detail_status: ImageQualityStatus;
  notes: string[];
  suggested_action: string;
}

export type NotionSyncState = "not_synced" | "syncing" | "synced" | "failed";
export type NotionCapabilityReason = "configured" | "backend_disabled" | "missing_credentials";
export type NotionSyncReason = NotionCapabilityReason | "client_disabled";
export type NotionSyncErrorCode =
  | "timeout"
  | "network"
  | "tls"
  | "rate_limited"
  | "authorization"
  | "schema"
  | "not_found"
  | "provider_rejected"
  | "unknown";

export interface NotionCapability {
  configured: boolean;
  creation_enabled: boolean;
  client_override_allowed: boolean;
  effective_request_enabled: boolean;
  reason: NotionCapabilityReason;
}

export interface NotionSyncStatus {
  status: NotionSyncState;
  reason?: NotionSyncReason | null;
  error_code?: NotionSyncErrorCode | null;
  page_id?: string | null;
  page_url?: string | null;
  last_attempt_at?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
  /** Non-fatal problems, e.g. "Video is too large for your Notion plan, so it wasn't uploaded." */
  warnings?: string[];
}

/**
 * The listing's one video. On Facebook Marketplace it goes in the separate
 * "Add video" slot, so the cover always stays a photo.
 */
export interface ListingVideo {
  /** Local file URI before upload, or the backend path `/api/items/{id}/video/{videoId}`. */
  uri: string;
  durationSeconds: number;
  mimeType?: string;
  sizeBytes?: number;
  /** Backend video id once uploaded. */
  videoId?: string;
  /** Local still for thumbnails (the player shows the video itself). */
  posterUri?: string;
}

export interface SavedListing {
  id: string;
  itemId: string;
  imageUri?: string;
  imageUris?: string[];
  video?: ListingVideo | null;
  title: string;
  description: string;
  category: string;
  activePrice?: number;
  activePriceSource?: ActivePriceSource;
  priceSuggestion?: PriceSuggestion;
  priceMin: number;
  priceMax: number;
  condition: string;
  listingQuality?: ListingQuality;
  missingChecklist?: ChecklistItem[];
  imageQualityFeedback?: ImageQualityFeedback[];
  notionPageId?: string;
  notionPageUrl?: string;
  lastSyncedSnapshot?: {
    title: string;
    description: string;
    category: string;
    condition: string;
    activePrice: number;
  };
  status: "draft" | "saved" | "posted";
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  purgeAt?: string;
}

export interface UserProfile {
  name: string;
  username: string;
  pickupLocation: string;
  paymentMethods: string;
}

export interface AIInsightsSettings {
  enabled: boolean;
}

export interface ListingDefaults {
  defaultLocalPickup: boolean;
}

export type ListingEditFocus =
  | "title"
  | "price"
  | "description_details"
  | "category"
  | "condition"
  | "brand_model"
  | "photos"
  | "all";

export interface ListingWorkspaceState {
  itemId?: string;
  savedId?: string;
  imageUri?: string;
  imageUris: string[];
  title: string;
  description: string;
  category: string;
  condition: string;
  activePrice: number;
  activePriceSource?: ActivePriceSource;
  priceSuggestion?: PriceSuggestion | null;
  listingQuality?: ListingQuality | null;
  missingChecklist: ChecklistItem[];
  imageQualityFeedback: ImageQualityFeedback[];
  video?: ListingVideo | null;
}

export interface DraftListingEdits {
  title?: string;
  description?: string;
  category?: string;
  condition?: string;
  activePrice?: number;
  activePriceSource?: ActivePriceSource;
  priceSuggestion?: PriceSuggestion;
  negotiable?: boolean;
  imageUris?: string[];
  imageQualityFeedback?: ImageQualityFeedback[];
  video?: ListingVideo | null;
  brandModel?: string;
  color?: string;
  material?: string;
  dimensions?: string;
  flaws?: string;
  accessories?: string;
  preferences?: string;
}

export interface AnalyzeResponse {
  item_id: string;
  analysis: VisionAnalysis;
  listing: GeneratedListing;
  missing_checklist: ChecklistItem[];
  image_quality_feedback: ImageQualityFeedback[];
}
