type SignedUrlEntry = { url: string; expiresAt: number };

const entries = new Map<string, SignedUrlEntry>();
const requests = new Map<string, Promise<string | null>>();

export function getSignedUrlEntry(key: string): SignedUrlEntry | undefined {
  const entry = entries.get(key);
  if (entry && entry.expiresAt > Date.now() + 60_000) return entry;
  if (entry) entries.delete(key);
  return undefined;
}

export function getSignedUrlRequest(key: string): Promise<string | null> | undefined {
  return requests.get(key);
}

export function setSignedUrlEntry(key: string, entry: SignedUrlEntry): void {
  entries.set(key, entry);
}

export function setSignedUrlRequest(key: string, request: Promise<string | null>): void {
  requests.set(key, request);
}

export function deleteSignedUrlRequest(key: string): void {
  requests.delete(key);
}

export function clearSignedImageUrlCache(): void {
  entries.clear();
  requests.clear();
}

export function clearSignedImageUrlCacheForUri(uid: string, uri: string): void {
  const key = `${uid}:${uri}`;
  entries.delete(key);
  requests.delete(key);
}

export function clearSignedImageUrlCacheForItem(itemId: string): void {
  const marker = `/api/items/${itemId}/image`;
  for (const key of entries.keys()) {
    if (key.includes(marker)) entries.delete(key);
  }
  for (const key of requests.keys()) {
    if (key.includes(marker)) requests.delete(key);
  }
}
