import type { InventoryFilter } from "../utils/listingReadiness";

/**
 * Which listings the Inventory tab shows. Home's "See all" sets it before
 * switching tabs; pressing any tab clears it (see the tab layout), so it lasts
 * while the seller opens a listing and comes back, but not across tab switches.
 */
let currentFilter: InventoryFilter = null;
const listeners = new Set<(filter: InventoryFilter) => void>();

export function getInventoryFilter(): InventoryFilter {
  return currentFilter;
}

export function setInventoryFilter(filter: InventoryFilter): void {
  if (filter === currentFilter) return;
  currentFilter = filter;
  listeners.forEach((listener) => listener(filter));
}

export function subscribeInventoryFilter(listener: (filter: InventoryFilter) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
