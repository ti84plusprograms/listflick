(globalThis as any).__DEV__ = false;

import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let mockCurrentUser: { uid: string } | null = { uid: "user-1" };
let mockIdTokenFn: (user: any, forceRefresh?: boolean) => Promise<string> = async (_user, force) =>
  force ? "refreshed-token" : "initial-token";

const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
  if (request.includes("firebase")) {
    return {
      getApp: () => ({}),
      getAuth: () => ({
        get currentUser() {
          return mockCurrentUser;
        },
      }),
      getIdToken: (user: any, forceRefresh?: boolean) => mockIdTokenFn(user, forceRefresh),
    };
  }
  if (request.includes("expo-constants")) {
    return {
      default: {
        expoConfig: {
          extra: { apiUrl: "https://api.test" },
        },
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

import {
  clearSignedImageUrlCache,
  clearSignedImageUrlCacheForItem,
  getSignedUrlEntry,
  getSignedUrlRequest,
  setSignedUrlEntry,
  setSignedUrlRequest,
} from "../utils/signedImageUrlCache";

const { API_BASE_URL } = require("../constants/config");
const {
  isProtectedApiUrl,
  invalidateAuthenticatedImageUri,
  resolveAuthenticatedImageUri,
} = require("../services/imageRetrieval") as typeof import("../services/imageRetrieval");

function equal<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

async function runTests() {
  // 1. isProtectedApiUrl correctly identifies protected vs external URLs
  equal(isProtectedApiUrl(`${API_BASE_URL}/api/items/item-1/image/0`), true, "API item URL is protected");
  equal(isProtectedApiUrl(API_BASE_URL), true, "API root URL is protected");
  equal(isProtectedApiUrl("https://storage.googleapis.com/bucket/image.jpg"), false, "External storage URL is not protected");
  equal(isProtectedApiUrl("file:///var/mobile/img.jpg"), false, "Local file URL is not protected");

  // 2. Unprotected URI returns { uri } immediately without auth or fetch calls
  let fetchCalled = false;
  global.fetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called for unprotected URIs");
  }) as any;

  const unprotected = await resolveAuthenticatedImageUri("https://external.test/photo.jpg");
  equal(unprotected, { uri: "https://external.test/photo.jpg" }, "unprotected URI returns raw uri without headers");
  equal(fetchCalled, false, "unprotected URI never calls fetch");

  // 3. Unauthenticated access throws Error
  mockCurrentUser = null;
  let authError: Error | null = null;
  try {
    await resolveAuthenticatedImageUri(`${API_BASE_URL}/api/items/item-1/image/0`);
  } catch (err) {
    authError = err as Error;
  }
  equal(authError?.message, "Authentication required to access this image.", "unauthenticated user throws auth error");
  mockCurrentUser = { uid: "user-1" };

  // 4. Successful signed-URL acquisition returns signed URL and populates cache
  clearSignedImageUrlCache();
  const calls: { url: string; headers: Record<string, string> }[] = [];
  global.fetch = (async (input: string, init?: RequestInit) => {
    calls.push({ url: input, headers: (init?.headers as Record<string, string>) ?? {} });
    return {
      ok: true,
      status: 200,
      json: async () => ({ url: "https://storage.test/signed-1.jpg", expires_in: 3600 }),
    };
  }) as any;

  const protectedUri = `${API_BASE_URL}/api/items/item-1/image/0`;
  const resolved = await resolveAuthenticatedImageUri(protectedUri);
  equal(resolved, { uri: "https://storage.test/signed-1.jpg" }, "returns signed URL when acquisition succeeds");
  equal(calls.length, 1, "fetch called once for signed URL");
  equal(calls[0].url, `${protectedUri}/url`, "calls /url sub-endpoint");
  equal(calls[0].headers["Authorization"], "Bearer initial-token", "uses active auth token header");

  // Cache hit does not call fetch again
  const cached = await resolveAuthenticatedImageUri(protectedUri);
  equal(cached, { uri: "https://storage.test/signed-1.jpg" }, "cached entry returned on subsequent request");
  equal(calls.length, 1, "fetch not called again when cached");

  // 5. Initial 401, forced token refresh succeeds, retry fetch succeeds -> returns signed URL
  clearSignedImageUrlCache();
  calls.length = 0;
  let refreshCalled = false;
  mockIdTokenFn = async (_user, force) => {
    if (force) {
      refreshCalled = true;
      return "refreshed-token-401";
    }
    return "initial-token";
  };
  global.fetch = (async (input: string, init?: RequestInit) => {
    const authHeader = (init?.headers as Record<string, string>)?.["Authorization"];
    calls.push({ url: input, headers: (init?.headers as Record<string, string>) ?? {} });
    if (authHeader === "Bearer initial-token") {
      return { ok: false, status: 401, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ url: "https://storage.test/signed-after-refresh.jpg", expires_in: 3600 }),
    };
  }) as any;

  const retryResolved = await resolveAuthenticatedImageUri(protectedUri);
  equal(refreshCalled, true, "forced token refresh was requested after 401");
  equal(calls.length, 2, "fetch called twice: once failing with 401, then retrying with refreshed token");
  equal(calls[1].headers["Authorization"], "Bearer refreshed-token-401", "retry used refreshed token");
  equal(
    retryResolved,
    { uri: "https://storage.test/signed-after-refresh.jpg" },
    "signed URL returned after successful refresh and retry",
  );

  // 6. Initial 401, forced token refresh fails -> falls back to protected API with original token
  clearSignedImageUrlCache();
  calls.length = 0;
  mockIdTokenFn = async (_user, force) => {
    if (force) throw new Error("Firebase network error during token refresh");
    return "initial-token";
  };
  global.fetch = (async (input: string, init?: RequestInit) => {
    calls.push({ url: input, headers: (init?.headers as Record<string, string>) ?? {} });
    return { ok: false, status: 401, json: async () => ({}) };
  }) as any;

  const fallbackOnRefreshFail = await resolveAuthenticatedImageUri(protectedUri);
  equal(
    fallbackOnRefreshFail,
    { uri: protectedUri, headers: { Authorization: "Bearer initial-token" } },
    "returns protected API URI with original token when refresh fails",
  );

  // 7. Initial 403, forced token refresh succeeds, retry fetch fails -> falls back to protected API with refreshed token
  clearSignedImageUrlCache();
  calls.length = 0;
  mockIdTokenFn = async (_user, force) => {
    if (force) return "refreshed-token-403";
    return "initial-token";
  };
  global.fetch = (async (input: string, init?: RequestInit) => {
    calls.push({ url: input, headers: (init?.headers as Record<string, string>) ?? {} });
    return { ok: false, status: 403, json: async () => ({}) };
  }) as any;

  const fallbackOnRetryFail = await resolveAuthenticatedImageUri(protectedUri);
  equal(
    fallbackOnRetryFail,
    { uri: protectedUri, headers: { Authorization: "Bearer refreshed-token-403" } },
    "returns protected API URI with refreshed token when retry fails",
  );

  // 8. Non-auth signing failure (e.g. 500 server error) falls back to authenticated API without token refresh
  clearSignedImageUrlCache();
  calls.length = 0;
  refreshCalled = false;
  mockIdTokenFn = async (_user, force) => {
    if (force) refreshCalled = true;
    return "initial-token";
  };
  global.fetch = (async (input: string, init?: RequestInit) => {
    calls.push({ url: input, headers: (init?.headers as Record<string, string>) ?? {} });
    return { ok: false, status: 500, json: async () => ({}) };
  }) as any;

  const fallbackOn500 = await resolveAuthenticatedImageUri(protectedUri);
  equal(refreshCalled, false, "token was not refreshed for non-auth 500 error");
  equal(calls.length, 1, "fetch called only once on 500 error");
  equal(
    fallbackOn500,
    { uri: protectedUri, headers: { Authorization: "Bearer initial-token" } },
    "returns protected API URI fallback on 500 error",
  );

  // 9. invalidateAuthenticatedImageUri removes cached signed URL entry
  clearSignedImageUrlCache();
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ url: "https://storage.test/cached.jpg", expires_in: 3600 }),
  })) as any;
  await resolveAuthenticatedImageUri(protectedUri);
  equal(Boolean(getSignedUrlEntry(`user-1:${protectedUri}`)), true, "cached entry exists");
  invalidateAuthenticatedImageUri(protectedUri);
  equal(getSignedUrlEntry(`user-1:${protectedUri}`), undefined, "cache invalidated");

  // 10. Item cache invalidation for clearSignedImageUrlCacheForItem
  clearSignedImageUrlCache();
  const targetBaseKey = "user-1:https://api.test/api/items/item-1/image";
  const targetIndexedKey = "user-1:https://api.test/api/items/item-1/image/0";
  const otherItemKey = "user-1:https://api.test/api/items/item-10/image/0";
  const expiresAt = Date.now() + 3_600_000;
  const targetRequest = Promise.resolve("https://storage.test/pending/item-1/1.jpg");
  setSignedUrlEntry(targetBaseKey, { url: "https://storage.test/pending/item-1/1.jpg", expiresAt });
  setSignedUrlEntry(targetIndexedKey, { url: "https://storage.test/pending/item-1/1.jpg", expiresAt });
  setSignedUrlEntry(otherItemKey, { url: "https://storage.test/item-10/1.jpg", expiresAt });
  setSignedUrlRequest(targetIndexedKey, targetRequest);

  clearSignedImageUrlCacheForItem("item-1");

  if (getSignedUrlEntry(targetBaseKey) || getSignedUrlEntry(targetIndexedKey)) {
    throw new Error("item cache invalidation must clear base and indexed image URLs");
  }
  if (getSignedUrlRequest(targetIndexedKey)) {
    throw new Error("item cache invalidation must clear matching in-flight requests");
  }
  if (!getSignedUrlEntry(otherItemKey)) {
    throw new Error("item cache invalidation must preserve other items");
  }
  clearSignedImageUrlCache();

  // 11. Static check: saveItemListing invalidates signed image URLs before returning
  const apiSource = readFileSync(resolve(__dirname, "../services/api.ts"), "utf8");
  const saveStart = apiSource.indexOf("export async function saveItemListing");
  const saveEnd = apiSource.indexOf("export async function trashItem", saveStart);
  const saveSource = apiSource.slice(saveStart, saveEnd);
  const requestIndex = saveSource.indexOf("const result = await requestJson<SaveListingResponse>");
  const clearIndex = saveSource.indexOf("clearSignedImageUrlCacheForItem(itemId)");
  const returnIndex = saveSource.indexOf("return result", clearIndex);
  if (requestIndex < 0 || clearIndex < requestIndex || returnIndex < clearIndex) {
    throw new Error("successful listing saves must invalidate signed image URLs before returning");
  }

  console.log("Image retrieval fallback tests passed.");
}

void runTests();
