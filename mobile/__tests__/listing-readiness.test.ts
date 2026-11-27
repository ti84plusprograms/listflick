import type { ImageQualityFeedback, SavedListing } from "../types/listing";
import {
  buildHomeModel,
  filterInventoryListings,
  formatListingPrice,
  homeSummary,
  isProfileSetupMissing,
  listingAskingPrice,
  listingMeta,
  needsReason,
  openBuyerQuestions,
  retakePhotoCount,
  savedWhen,
  statusLabel,
} from "../utils/listingReadiness";

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function deepEqual<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function feedback(index: number, status: ImageQualityFeedback["overall_status"]): ImageQualityFeedback {
  return {
    image_id: "",
    image_index: index,
    overall_status: status,
    sharpness_status: "good",
    brightness_status: "good",
    contrast_status: "good",
    detail_status: "good",
    notes: [],
    suggested_action: "",
  };
}

function listing(overrides: Partial<SavedListing> & Record<string, unknown> = {}): SavedListing {
  return {
    id: "a",
    itemId: "item-a",
    imageUris: ["one.jpg", "two.jpg"],
    title: "Spigen Power Bank",
    description: "Details:\n- USB-C\n\nCondition: Good",
    category: "Electronics",
    activePrice: 25,
    priceMin: 20,
    priceMax: 30,
    condition: "Good",
    status: "saved",
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z",
    ...overrides,
  } as SavedListing;
}

// needsReason: same order as the approved prototype.
equal(needsReason(listing()), null, "complete listing needs nothing");
equal(statusLabel(listing()), "Ready to list", "complete listing badge");
deepEqual(
  needsReason(listing({ activePrice: 0, priceMin: 0, priceMax: 0, priceSuggestion: undefined })),
  { text: "Add a price" },
  "missing price comes first",
);
equal(statusLabel(listing({ activePrice: 0, priceMin: 0, priceMax: 0 })), "Draft", "missing price badge");
equal(listingAskingPrice(listing({ activePrice: 0, priceMin: 0, priceMax: 40 })), 40, "price falls back to range");
deepEqual(needsReason(listing({ title: "  " })), { text: "Add a title" }, "missing title");
deepEqual(needsReason(listing({ description: "" })), { text: "Write a description" }, "missing description");
deepEqual(needsReason(listing({ imageUris: [], imageUri: undefined })), { text: "Add photos" }, "missing photos");
equal(needsReason(listing({ imageUris: undefined, imageUri: "cover.jpg" })), null, "legacy single imageUri counts");
deepEqual(
  needsReason(listing({ imageQualityFeedback: [feedback(0, "good"), feedback(1, "poor")] })),
  { text: "Retake 1 photo" },
  "one poor photo",
);
deepEqual(
  needsReason(listing({ imageQualityFeedback: [feedback(0, "poor"), feedback(1, "poor")] })),
  { text: "Retake 2 photos" },
  "two poor photos",
);
equal(retakePhotoCount(1, [feedback(0, "good"), feedback(1, "poor")]), 0, "feedback for removed photos is ignored");
equal(retakePhotoCount(2, [feedback(0, "needs_improvement")]), 0, "needs_improvement is not a retake");

// Buyer questions: optional fields from the analysis, many shapes tolerated.
deepEqual(openBuyerQuestions(listing()), [], "no question fields");
deepEqual(openBuyerQuestions(null), [], "null listing");
deepEqual(
  needsReason(
    listing({
      buyer_questions: [{ question: "Does it hold a charge?" }, { question: "Any scratches?", answer: "No" }],
      price_question: { question: "Is the original box included?" },
    }),
  ),
  { text: "Is the original box included?", tag: "Affects price" },
  "price question first with tag",
);
deepEqual(
  needsReason(listing({ buyerQuestions: ["Which model is it?"], activePrice: 0 })),
  { text: "Which model is it?", tag: undefined },
  "questions outrank a missing price",
);
deepEqual(
  openBuyerQuestions({ buyerQuestions: [{ text: "Size?", affects_price: true }, { question: "Color?", answered: true }, 7] }),
  [{ question: "Size?", affectsPrice: true }],
  "camelCase, answered and junk entries",
);
deepEqual(
  openBuyerQuestions({ price_question: "Original box?", buyer_questions: ["original box?"] }),
  [{ question: "Original box?", affectsPrice: true }],
  "duplicates collapse",
);

// Summary line.
equal(homeSummary([]), null, "no summary without listings");
equal(homeSummary([listing()]), "1 listing · 1 ready to post", "singular summary");
equal(
  homeSummary([listing(), listing({ id: "b", title: "" })]),
  "2 listings · 1 ready to post",
  "mixed summary",
);
equal(homeSummary([listing({ title: "" }), listing({ id: "b", title: "" })]), "2 listings · not ready yet", "none ready");

// savedWhen.
const now = new Date(2026, 10, 27, 15, 0, 0);
equal(savedWhen(new Date(2026, 10, 27, 1, 0, 0).toISOString(), now), "Saved today", "today");
equal(savedWhen(new Date(2026, 10, 26, 23, 0, 0).toISOString(), now), "Saved yesterday", "yesterday");
equal(savedWhen(new Date(2026, 10, 3, 9, 0, 0).toISOString(), now), "Saved Nov 3", "older date");
equal(savedWhen(undefined, now), "", "missing date");
equal(savedWhen("not a date", now), "", "bad date");

equal(formatListingPrice(25), "$25", "whole price");
equal(formatListingPrice(12.5), "$12.50", "cents");
equal(formatListingPrice(0), "", "no price");
equal(listingMeta(["$25", "", "Draft"]), "$25 · Draft", "meta joins non-empty parts");

// Inventory filter matches needsReason exactly.
const all = [listing(), listing({ id: "b", title: "" }), listing({ id: "c", activePrice: 0, priceMin: 0, priceMax: 0 })];
deepEqual(filterInventoryListings(all, null).map((l) => l.id), ["a", "b", "c"], "no filter shows all");
deepEqual(filterInventoryListings(all, "attention").map((l) => l.id), ["b", "c"], "attention filter");

// Profile setup.
equal(isProfileSetupMissing(null), true, "no profile");
equal(isProfileSetupMissing({ pickupLocation: "Midtown", paymentMethods: " " }), true, "payment missing");
equal(isProfileSetupMissing({ pickupLocation: "Midtown", paymentMethods: "Cash" }), false, "profile set");

// Home states.
const profile = { pickupLocation: "Midtown", paymentMethods: "Cash" };
const empty = buildHomeModel({ listings: [], pendingCount: 0, profile: null });
equal(empty.isFirstRun, true, "empty is first run");
equal(empty.attentionCount, 0, "first run has no attention rows");
equal(empty.setupMissing, true, "first run setup missing");
equal(empty.caughtUp, false, "first run is not caught up");

const pendingOnly = buildHomeModel({ listings: [], pendingCount: 1, profile });
equal(pendingOnly.isFirstRun, false, "pending analysis leaves first run");
equal(pendingOnly.attentionCount, 1, "pending counts as attention");

const caughtUp = buildHomeModel({
  listings: [
    listing({ id: "old", updatedAt: "2026-11-01T00:00:00.000Z" }),
    listing({ id: "new", updatedAt: "2026-11-25T00:00:00.000Z" }),
  ],
  pendingCount: 0,
  profile,
});
equal(caughtUp.caughtUp, true, "everything ready");

const caughtUpNoSetup = buildHomeModel({ listings: [listing({ id: "only" })], pendingCount: 0, profile: null });
equal(caughtUpNoSetup.attentionCount, 0, "missing setup is not an attention row");
equal(caughtUpNoSetup.caughtUp, true, "missing setup alone still reads as caught up");
equal(caughtUpNoSetup.setupMissing, true, "setup pill still shows");
deepEqual(caughtUp.ready.map((l) => l.id), ["new", "old"], "ready sorted newest first");

const needsWork = buildHomeModel({ listings: all, pendingCount: 1, profile: null });
equal(needsWork.caughtUp, false, "attention state");
equal(needsWork.attention.length, 2, "two listings need attention");
equal(needsWork.attentionCount, 3, "pending + listings; setup is its own pill");
equal(needsWork.summary, "3 listings · 1 ready to post", "summary in model");

console.log("listing readiness tests passed");
