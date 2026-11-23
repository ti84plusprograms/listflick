import { API_BASE_URL } from "../constants/config";
import { AuthUser, getAuthIdToken, getAuthUser } from "./authSession";
import {
  clearSignedImageUrlCacheForUri,
  deleteSignedUrlRequest,
  getSignedUrlEntry,
  getSignedUrlRequest,
  setSignedUrlEntry,
  setSignedUrlRequest,
} from "../utils/signedImageUrlCache";

export type ResolvedImage = { uri: string; headers?: Record<string, string> };

export function isProtectedApiUrl(uri: string): boolean {
  const apiBase = API_BASE_URL.replace(/\/$/, "");
  return uri === apiBase || uri.startsWith(`${apiBase}/`);
}

/** Discards a failed protected-image resolution before an explicit user retry. */
export function invalidateAuthenticatedImageUri(uri: string): void {
  if (!isProtectedApiUrl(uri)) return;
  const user = getAuthUser();
  if (user) clearSignedImageUrlCacheForUri(user.uid, uri);
}

class SignedImageUrlError extends Error {
  constructor(public readonly status: number) {
    super(`Signed image URL request returned ${status}`);
    this.name = "SignedImageUrlError";
  }
}

let tokenRequest: { uid: string; promise: Promise<string> } | null = null;

function getSharedIdToken(user: AuthUser): Promise<string> {
  if (tokenRequest?.uid === user.uid) return tokenRequest.promise;
  const promise = getAuthIdToken(user)
    .then((token) => {
      if (!token) throw new Error("Authentication token unavailable.");
      return token;
    })
    .finally(() => {
      if (tokenRequest?.promise === promise) tokenRequest = null;
    });
  tokenRequest = { uid: user.uid, promise };
  return promise;
}

async function getSignedImageUrl(apiUri: string, uid: string, token: string): Promise<string | null> {
  const cacheKey = `${uid}:${apiUri}`;
  const cached = getSignedUrlEntry(cacheKey);
  if (cached) return cached.url;
  const existingRequest = getSignedUrlRequest(cacheKey);
  if (existingRequest) return existingRequest;

  const request = fetch(`${apiUri}/url`, { headers: { Authorization: `Bearer ${token}` } })
    .then(async (response) => {
      if (!response.ok) throw new SignedImageUrlError(response.status);
      const payload = (await response.json()) as { url?: string | null; expires_in?: number };
      if (!payload.url) return null;
      const lifetimeMs = Math.max((payload.expires_in ?? 3600) - 60, 60) * 1000;
      setSignedUrlEntry(cacheKey, { url: payload.url, expiresAt: Date.now() + lifetimeMs });
      return payload.url;
    })
    .finally(() => deleteSignedUrlRequest(cacheKey));
  setSignedUrlRequest(cacheKey, request);
  return request;
}

/** Resolve a protected API image to a short-lived signed URL or auth fallback. */
export async function resolveAuthenticatedImageUri(uri: string): Promise<ResolvedImage> {
  if (!isProtectedApiUrl(uri)) return { uri };
  const user = getAuthUser();
  if (!user) throw new Error("Authentication required to access this image.");

  let token = await getSharedIdToken(user);
  try {
    const signedUrl = await getSignedImageUrl(uri, user.uid, token);
    if (signedUrl) return { uri: signedUrl };
  } catch (error) {
    const status = error instanceof SignedImageUrlError ? error.status : undefined;
    if (status === 401 || status === 403) {
      try {
        const refreshedToken = await getAuthIdToken(user, true);
        if (refreshedToken) {
          token = refreshedToken;
          try {
            const signedUrl = await getSignedImageUrl(uri, user.uid, token);
            if (signedUrl) return { uri: signedUrl };
          } catch {
            // Preserve the authenticated API fallback when the retry fails.
          }
        }
      } catch {
        // Preserve the original token for the authenticated API fallback.
      }
    }
  }
  return { uri, headers: { Authorization: `Bearer ${token}` } };
}
