import type {
  ActivePriceSource,
  AnalyzeResponse,
  ChecklistItem,
  GeneratedListing,
  ImageQualityFeedback,
  NotionSyncStatus,
  NotionCapability,
  VisionAnalysis,
} from "./listing";

/** Response shapes corresponding to the backend FastAPI item contract. */
export type UploadResponse = {
  item_id: string;
  image_url: string;
  image_urls: string[];
  image_quality_feedback: ImageQualityFeedback[];
  status: "uploading" | "uploaded";
};

export type AnalysisJobState =
  | "queued"
  | "processing"
  | "succeeded"
  | "retryable_failed"
  | "terminal_failed";

export type AnalysisJobStatus = {
  item_id: string;
  status: AnalysisJobState;
  attempt_count: number;
  can_retry: boolean;
  last_error_code?: string | null;
  lease_expires_at?: string | null;
};

export type AnalysisJobResponse = {
  job: AnalysisJobStatus;
};

export type HealthResponse = {
  status: string;
  ai_provider?: "gemini" | "groq" | string;
  allow_server_ai_key_fallback?: boolean;
  gemini_configured?: boolean;
  groq_configured?: boolean;
  claude_configured?: boolean;
  claude_vision_model?: string;
  claude_text_model?: string;
  notion_configured?: boolean;
  notion_client_override_allowed?: boolean;
  notion_capability?: NotionCapability;
};

export type SaveListingResponse = {
  item_id: string;
  notion_page_id?: string | null;
  notion_synced: boolean;
  notion_sync: NotionSyncStatus;
  listing?: GeneratedListing | null;
  missing_checklist: ChecklistItem[];
  image_quality_feedback: ImageQualityFeedback[];
};

export type ImproveListingResponse = {
  item_id?: string | null;
  listing: GeneratedListing;
  missing_checklist: ChecklistItem[];
};

export type ListingAnswer = {
  question: string;
  answer: string;
  affects_price: boolean;
};

/** Seller edits that can change the price (sent from the edit form). Omitted fields are unchanged. */
export type ListingChanges = {
  condition?: string;
  flaws?: string;
  brand_model?: string;
  accessories?: string;
};

export type ListingAnswersRequest = {
  answers?: ListingAnswer[];
  changes?: ListingChanges | null;
  listing?: GeneratedListing | null;
  active_price?: number;
  active_price_source?: ActivePriceSource | null;
  dismiss?: boolean;
};

export type ListingAnswersResponse = {
  item_id: string;
  listing: GeneratedListing;
  analysis?: VisionAnalysis | null;
  missing_checklist: ChecklistItem[];
  repriced: boolean;
  active_price: number;
  active_price_source?: ActivePriceSource | null;
};

export type ItemResponse = {
  id: string;
  image_url: string;
  status: string;
  analysis?: VisionAnalysis | null;
  listing?: GeneratedListing | null;
  missing_checklist: ChecklistItem[];
  image_quality_feedback: ImageQualityFeedback[];
  analysis_job?: AnalysisJobStatus | null;
  notion_sync: NotionSyncStatus;
  video?: ItemVideo | null;
  created_at: string;
  updated_at: string;
};

/** The listing's one video as the backend stores it (`backend/app/schemas/listing.py`). */
export type ItemVideo = {
  id: string;
  url: string;
  content_type: string;
  size_bytes: number;
  duration_seconds: number;
  frame_count: number;
  cover_from_video: boolean;
};

export type ItemVideoResponse = {
  item_id: string;
  video?: ItemVideo | null;
  image_url?: string | null;
  image_urls: string[];
  status: "uploading" | "uploaded";
};

export type ApiAnalyzeResponse = AnalyzeResponse;

export type RecheckListingRequest = {
  item_id?: string | null;
  title: string;
  description: string;
  category: string;
  condition: string;
  asking_price: number;
  tips: { text: string; done: boolean }[];
  include_images: boolean;
};

export type RecheckListingResponse = {
  item_id?: string | null;
  tips: { text: string; done: boolean }[];
  image_quality_feedback: ImageQualityFeedback[];
  checked_images: number;
};
