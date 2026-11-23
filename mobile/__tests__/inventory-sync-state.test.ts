import {
  snapshotFromListing,
  snapshotsEqual,
  type ListingSnapshot,
} from "../utils/inventorySyncState";

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const snap = snapshotFromListing({
  title: "Widget",
  description: "A fine widget.",
  category: "Electronics",
  condition: "good",
  activePrice: 50,
});
equal(snap.title, "Widget", "extracts title");
equal(snap.description, "A fine widget.", "extracts description");
equal(snap.category, "Electronics", "extracts category");
equal(snap.condition, "Good", "normalizes condition");
equal(snap.activePrice, 50, "extracts activePrice");

const snapTrimmed = snapshotFromListing({
  title: "  Widget  ",
  description: "  A fine widget.  ",
  category: " Electronics ",
  condition: " like new ",
  activePrice: 50,
});
equal(snapTrimmed.title, "Widget", "trims title");
equal(snapTrimmed.description, "A fine widget.", "trims description");
equal(snapTrimmed.category, "Electronics", "trims category");
equal(snapTrimmed.condition, "Like New", "normalizes and trims condition");

const snapUnknown = snapshotFromListing({
  title: "Widget",
  description: "Desc",
  category: "Cat",
  condition: "refurbished",
  activePrice: 10,
});
equal(snapUnknown.condition, "refurbished", "uses an unknown raw condition");

const a: ListingSnapshot = {
  title: "A",
  description: "D",
  category: "C",
  condition: "Good",
  activePrice: 10,
};
const b: ListingSnapshot = { ...a };
equal(snapshotsEqual(a, b), true, "identical snapshots are equal");
equal(snapshotsEqual(a, { ...b, title: "B" }), false, "detects a changed title");
equal(snapshotsEqual(a, { ...b, description: "X" }), false, "detects a changed description");
equal(snapshotsEqual(a, { ...b, category: "X" }), false, "detects a changed category");
equal(snapshotsEqual(a, { ...b, condition: "Fair" }), false, "detects a changed condition");
equal(snapshotsEqual(a, { ...b, activePrice: 99 }), false, "detects a changed price");

console.log("Inventory sync state tests passed.");
