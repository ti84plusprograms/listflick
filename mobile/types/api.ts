import type {
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
  ai_mode?: "provider" | "deterministic_e2e" | string;
  ai_provider?: "gemini" | "groq" | string;
  allow_server_ai_key_fallback?: boolean;
  gemini_configured?: boolean;
  groq_configured?: boolean;
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
  created_at: string;
  updated_at: string;
};

export type ApiAnalyzeResponse = AnalyzeResponse;
