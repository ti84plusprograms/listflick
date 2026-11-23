import { scopedStorageKey } from "../utils/storageScope";

function equal(actual: string, expected: string, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

equal(
  scopedStorageKey("@listings", "firebase-user-a"),
  "@listings:firebase-user-a",
  "authenticated listing storage is scoped to the Firebase UID"
);
equal(
  scopedStorageKey("@listings", "firebase-user-b"),
  "@listings:firebase-user-b",
  "different Firebase UIDs receive different listing storage keys"
);
equal(
  scopedStorageKey("@listings"),
  "@listings:signed-out",
  "missing authentication uses an isolated signed-out scope"
);

console.log("Storage scope tests passed.");
