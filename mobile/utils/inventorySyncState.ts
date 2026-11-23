import { normalizeListingCondition } from "./descriptionFormatter";

/**
 * A snapshot of the 5 key listing fields used to detect
 * whether an already-synced listing has been edited locally.
 */
export interface ListingSnapshot {
  title: string;
  description: string;
  category: string;
  condition: string;
  activePrice: number;
}

/**
 * Creates a normalized snapshot from a listing-like object.
 * Strings are trimmed and condition is run through normalizeListingCondition
 * to avoid false positives from casing or whitespace mismatches.
 */
export function snapshotFromListing(listing: {
  title: string;
  description: string;
  category: string;
  condition: string;
  activePrice: number;
}): ListingSnapshot {
  return {
    title: listing.title.trim(),
    description: listing.description.trim(),
    category: listing.category.trim(),
    condition: (normalizeListingCondition(listing.condition) || listing.condition).trim(),
    activePrice: listing.activePrice,
  };
}

/**
 * Returns true if two snapshots represent the same listing data.
 */
export function snapshotsEqual(a: ListingSnapshot, b: ListingSnapshot): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.category === b.category &&
    a.condition === b.condition &&
    a.activePrice === b.activePrice
  );
}

export type InventorySyncState = "unsaved" | "saved" | "dirty";
