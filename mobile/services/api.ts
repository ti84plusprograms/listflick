import { API_BASE_URL } from "@/constants/config";
import { getApp } from '@react-native-firebase/app';
import type {
  ImprovementAction,
} from "@/types/listing";
import type {
  ApiAnalyzeResponse,
  AnalysisJobResponse,
  ImproveListingResponse,
  HealthResponse,
  ItemResponse,
  SaveListingResponse,
  UploadResponse,
} from "@/types/api";
import type { GeneratedListing, ImageQualityFeedback } from "@/types/listing";

import { getAuthUser, getAuthIdToken } from './authSession';
import { getDeveloperNotionMode, getEffectiveAIProvider, getSelectedAIProvider } from "./storage";
import { authDebugLog, authDebugWarn } from "../utils/authDebug";
import { clearSignedImageUrlCacheForItem } from "../utils/signedImageUrlCache";
import { getProviderApiKey, type AIProvider } from "./aiCredentials";
import { isServerAIKeyFallbackAvailable } from "../utils/aiProviderAvailability";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues?: string[],
    public imageQualityFeedback?: ImageQualityFeedback[],
    public code?: string,
    public provider?: AIProvider,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 25000;
const ANALYZE_TIMEOUT_MS = 120000;

type RequestOptions = {
  timeoutMs?: number;
  headers?: HeadersInit;
};

type ApiErrorBody = {
  detail?: unknown;
};

type ImageQualityErrorDetail = {
  detail?: string;
  issues: string[];
  image_quality_feedback?: ImageQualityFeedback[];
};

function aiProviderFromErrorDetail(detail: unknown): AIProvider | undefined {
  if (typeof detail !== "object" || detail === null || !("provider" in detail)) return undefined;
  const provider = String((detail as { provider: unknown }).provider);
  return provider === "gemini" || provider === "groq" ? provider : undefined;
}

type MultipartFilenameResolver = (uri: string, index: number) => string;

async function fetchWithAuth(
  input: RequestInfo,
  init?: RequestInit,
  options: RequestOptions = {}
): Promise<Response> {
  const currentUser = getAuthUser();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const request = async (forceRefresh: boolean): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const optionHeaders = new Headers(options.headers);
    optionHeaders.forEach((value, key) => headers.set(key, value));
    if (currentUser) {
      try {
        const token = await getAuthIdToken(currentUser, forceRefresh);
        if (token) headers.set('Authorization', `Bearer ${token}`);
      } catch (error) {
        authDebugWarn('API Firebase token acquisition failed', {
          forceRefresh,
          uid: currentUser.uid,
          error: String(error),
        });
        throw new ApiError('Authentication expired. Please sign in again.', 401);
      }
    }

    return fetch(input, {
      ...init,
      headers,
      signal: init?.signal ?? controller.signal,
    });
  };

  try {
    let response = await request(false);
    if (currentUser && (response.status === 401 || response.status === 403)) {
      authDebugLog('API auth response requires one forced token refresh', {
        status: response.status,
        uid: currentUser.uid,
      });
      response = await request(true);
    }
    return response;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new ApiError(
        `Backend request timed out. Please check that the server at ${API_BASE_URL} is running and responsive.`,
        504
      );
    }
    if (err instanceof TypeError || (err?.message && String(err.message).includes("Network request failed"))) {
      throw new ApiError(
        `Cannot connect to backend server at ${API_BASE_URL}.\n\nPlease ensure the backend is running (e.g. 'make backend') and accessible on your network.`,
        503
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readApiErrorBody(response: Response): Promise<ApiErrorBody> {
  return response.json().catch(() => ({}));
}

function isImageQualityErrorDetail(detail: unknown): detail is ImageQualityErrorDetail {
  return typeof detail === "object" && detail !== null && Boolean((detail as { issues?: unknown }).issues);
}

async function parseApiError(
  response: Response,
  fallbackMessage: string,
  options: { imageQualityFallback?: string; stringDetailOnly?: boolean } = {}
): Promise<ApiError> {
  const body = await readApiErrorBody(response);
  const detail = body.detail;

  if (options.imageQualityFallback && response.status === 422 && isImageQualityErrorDetail(detail)) {
    return new ApiError(
      detail.detail ?? options.imageQualityFallback,
      422,
      detail.issues,
      detail.image_quality_feedback ?? []
    );
  }

  if (options.stringDetailOnly) {
    return new ApiError(
      typeof detail === "string" ? detail : fallbackMessage,
      response.status
    );
  }

  const message = typeof detail === "object" && detail !== null && "message" in detail
    ? String((detail as { message: unknown }).message)
    : typeof detail === "string" ? detail : fallbackMessage;
  const code = typeof detail === "object" && detail !== null && "code" in detail
    ? String((detail as { code: unknown }).code)
    : undefined;
  return new ApiError(
    message,
    response.status,
    undefined,
    undefined,
    code,
    aiProviderFromErrorDetail(detail),
  );
}

async function aiRequestHeaders(): Promise<HeadersInit> {
  const currentUser = getAuthUser();
  if (!currentUser) throw new ApiError("Please sign in to use AI features.", 401);
  const health = await getHealth();
  const savedProvider = await getSelectedAIProvider();
  const provider = await getEffectiveAIProvider(health);
  if (!provider || (provider !== "gemini" && provider !== "groq")) {
    throw new ApiError(
      "Choose an AI provider and add its API key in Settings before using AI.",
      503,
      undefined,
      undefined,
      "AI_PROVIDER_SELECTION_REQUIRED",
    );
  }
  const key = await getProviderApiKey(currentUser.uid, provider);
  const headers: Record<string, string> = { "X-ListFlick-AI-Provider": provider };
  const fallbackAvailable = isServerAIKeyFallbackAvailable(health, provider);
  const backendProvider = health.ai_provider === "gemini" || health.ai_provider === "groq"
    ? health.ai_provider
    : "none";
  const providerServerKeyConfigured = provider === "gemini"
    ? Boolean(health.gemini_configured)
    : Boolean(health.groq_configured);
  if (!key?.trim()) {
    if (fallbackAvailable) {
      console.log(
        `[AI] Outgoing request: savedProvider=${savedProvider ?? "none"}, backendProvider=${backendProvider}, effectiveProvider=${provider}, deviceKey=false, fallbackEnabled=${health.allow_server_ai_key_fallback === true}, providerServerKeyConfigured=${providerServerKeyConfigured}, source=server_fallback`,
      );
      return headers;
    }
    const label = provider[0].toUpperCase() + provider.slice(1);
    throw new ApiError(
      `Add a ${label} API key in Settings to use ${label}.`,
      503,
      undefined,
      undefined,
      "AI_CREDENTIAL_REQUIRED",
      provider,
    );
  }
  console.log(
    `[AI] Outgoing request: savedProvider=${savedProvider ?? "none"}, backendProvider=${backendProvider}, effectiveProvider=${provider}, deviceKey=true, fallbackEnabled=${health.allow_server_ai_key_fallback === true}, providerServerKeyConfigured=${providerServerKeyConfigured}, source=device_byok`,
  );
  headers["X-ListFlick-AI-Key"] = key;
  return headers;
}


async function throwApiError(
  response: Response,
  fallbackMessage: string,
  options?: { imageQualityFallback?: string; stringDetailOnly?: boolean }
): Promise<never> {
  throw await parseApiError(response, fallbackMessage, options);
}

async function requestJson<TResponse>(
  path: string,
  method: "GET" | "POST",
  fallbackMessage: string,
  payload?: unknown,
  options?: RequestOptions
): Promise<TResponse> {
  const init: RequestInit = { method };
  if (payload !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(payload);
  }

  const response = await fetchWithAuth(`${API_BASE_URL}${path}`, init, options);
  if (!response.ok) {
    await throwApiError(response, fallbackMessage);
  }

  return response.json();
}

function imageMimeType(filename: string): string {
  const match = /\.(\w+)$/.exec(filename);
  return match ? `image/${match[1]}` : "image/jpeg";
}

function createImageFormData(uris: string[], filenameForUri: MultipartFilenameResolver): FormData {
  const formData = new FormData();
  uris.forEach((uri, index) => {
    const filename = filenameForUri(uri, index);

    formData.append("files", {
      uri,
      name: filename,
      type: imageMimeType(filename),
    } as unknown as Blob);
  });
  return formData;
}

function uploadFilename(uri: string, index: number): string {
  return uri.split("/").pop() ?? `photo-${index + 1}.jpg`;
}

function replacementFilename(uri: string, index: number): string {
  const pathName = uri.split("?")[0].split("/").pop() ?? "";
  return /\.\w+$/.test(pathName) ? pathName : `photo-${index + 1}.jpg`;
}

async function requestMultipart<TResponse>(
  path: string,
  method: "POST" | "PUT",
  uris: string[],
  filenameForUri: MultipartFilenameResolver,
  fallbackMessage: string,
  options?: RequestOptions
): Promise<TResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}${path}`, {
    method,
    body: createImageFormData(uris, filenameForUri),
  }, options);

  if (!response.ok) {
    await throwApiError(response, fallbackMessage, {
      imageQualityFallback: "Image quality check failed",
      stringDetailOnly: true,
    });
  }

  return response.json();
}

export async function uploadImage(uri: string): Promise<UploadResponse> {
  return uploadImages([uri]);
}

export async function uploadImages(uris: string[], idempotencyKey?: string): Promise<UploadResponse> {
  return requestMultipart(
    "/api/items/upload-multiple",
    "POST",
    uris,
    uploadFilename,
    "Upload failed",
    idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : undefined
  );
}

export async function replaceItemImages(itemId: string, uris: string[]): Promise<UploadResponse> {
  const result = await requestMultipart<UploadResponse>(
    `/api/items/${itemId}/images`,
    "PUT",
    uris,
    replacementFilename,
    "Could not update photos"
  );
  clearSignedImageUrlCacheForItem(itemId);
  return result;
}

export async function analyzeItem(itemId: string): Promise<ApiAnalyzeResponse> {
  const headers = await aiRequestHeaders();
  return requestJson(
    "/api/items/analyze",
    "POST",
    "Analysis failed",
    { item_id: itemId },
    { timeoutMs: ANALYZE_TIMEOUT_MS, headers }
  );
}

export async function startOrResumeAnalysis(itemId: string): Promise<AnalysisJobResponse> {
  const headers = await aiRequestHeaders();
  return requestJson(
    `/api/items/${itemId}/analysis-jobs`,
    "POST",
    "Could not start analysis",
    undefined,
    { timeoutMs: ANALYZE_TIMEOUT_MS, headers }
  );
}

export async function getAnalysisJobStatus(itemId: string): Promise<AnalysisJobResponse> {
  return requestJson(
    `/api/items/${itemId}/analysis-jobs`,
    "GET",
    "Could not check analysis status"
  );
}

export async function getHealth(): Promise<HealthResponse> {
  return requestJson("/health", "GET", "Could not check backend capability");
}

export async function saveItemListing(
  itemId: string,
  payload: {
    title: string;
    description: string;
    category: string;
    condition: string;
    asking_price: number;
  }
): Promise<SaveListingResponse> {
  const result = await requestJson<SaveListingResponse>(
    `/api/items/${itemId}/save`,
    "POST",
    "Save failed",
    {
      ...payload,
      notion_sync_enabled: await getDeveloperNotionMode(),
    }
  );
  clearSignedImageUrlCacheForItem(itemId);
  return result;
}

export async function trashItem(itemId: string, retentionDays: number): Promise<{ item_id: string; deleted_at: string; purge_at: string }> {
  return requestJson(
    `/api/items/${itemId}/trash`,
    "POST",
    "Could not move listing to Recently Deleted",
    { retention_days: retentionDays }
  );
}

export async function restoreItem(itemId: string): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE_URL}/api/items/${itemId}/restore`, { method: "POST" });
  if (!response.ok) {
    await throwApiError(response, "Could not restore listing");
  }
}

export async function permanentlyDeleteItem(itemId: string): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE_URL}/api/items/${itemId}`, { method: "DELETE" });
  if (!response.ok) {
    await throwApiError(response, "Could not permanently delete listing");
  }
}

export async function discardPendingItem(itemId: string): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE_URL}/api/items/${itemId}/draft`, { method: "DELETE" });
  if (!response.ok) {
    await throwApiError(response, "Could not discard pending listing");
  }
}

export async function deleteAccount(): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE_URL}/api/account`, { method: "DELETE" });
  if (!response.ok) {
    await throwApiError(response, "Could not delete account");
  }
}

export async function cleanupExpiredItems(): Promise<void> {
  await fetchWithAuth(`${API_BASE_URL}/api/items/cleanup`, { method: "POST" });
}

export async function retryNotionSync(
  itemId: string
): Promise<SaveListingResponse> {
  return requestJson(
    `/api/items/${itemId}/notion/retry`,
    "POST",
    "Retry sync failed",
    { notion_sync_enabled: await getDeveloperNotionMode() }
  );
}

export async function improveListing(payload: {
  item_id?: string | null;
  listing: GeneratedListing;
  action: ImprovementAction;
  custom_instruction?: string;
}): Promise<ImproveListingResponse> {
  const headers = await aiRequestHeaders();
  return requestJson("/api/items/improve", "POST", "Could not improve listing", payload, { headers });
}

export async function getItem(itemId: string): Promise<ItemResponse> {
  return requestJson(`/api/items/${itemId}`, "GET", "Could not fetch item");
}

export function imageUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${API_BASE_URL}${path}`;
}

export function resolveImageUri(uri?: string | null, itemId?: string | null, index: number = 0): string | null {
  if (!uri && itemId) {
    return imageUrl(`/api/items/${itemId}/image/${index}`);
  }
  if (!uri) return null;
  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  if (itemId && (uri.startsWith("file:") || uri.startsWith("ph:") || uri.startsWith("content:"))) {
    return imageUrl(`/api/items/${itemId}/image/${index}`);
  }
  if (uri.startsWith("/")) {
    return imageUrl(uri);
  }
  return uri;
}
