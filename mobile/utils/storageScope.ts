export function scopedStorageKey(key: string, userId?: string): string {
  return `${key}:${userId ?? "signed-out"}`;
}
