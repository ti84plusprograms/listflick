import {
  buildReadinessChecklist,
  hasDetailedDescription,
  isPhotoTip,
  mediaSignature,
  pendingRecheck,
  qualityWithTips,
  readinessLabel,
  textSignature,
  tipsFromQuality,
  type ReadinessInput,
} from "../utils/readinessChecklist";

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

const NEW_LAYOUT = "Portable charger.\n\nDetails:\n- 10000mAh\n- USB-C\n\nCondition: Good, light scuffs.";
const LEGACY_LAYOUT = "Portable charger.\n\n🔹 Features:\n- 10000mAh\n\n💵 Price: $25\n\n✅ Condition: Good";

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    title: "Spigen Power Bank 10000mAh",
    description: NEW_LAYOUT,
    price: 25,
    photoCount: 4,
    retakePhotoCount: 0,
    openQuestionCount: 0,
    pickupLocation: "Midtown",
    paymentMethods: "Cash",
    insightsEnabled: true,
    tips: [],
    ...overrides,
  };
}

// Everything done, no tips: the hidden AI item still counts, so 100.
const perfect = buildReadinessChecklist(input());
equal(perfect.score, 100, "complete listing scores 100");
equal(perfect.label, "Ready", "complete label");
equal(perfect.items.some((item) => item.label === "AI suggestions"), false, "AI placeholder is hidden");
equal(perfect.items.every((item) => item.done), true, "every visible item done");

// The owner's complaint: adding photos must move the score immediately.
const twoPhotos = buildReadinessChecklist(input({ photoCount: 2 }));
const fourPhotos = buildReadinessChecklist(input({ photoCount: 4 }));
equal(twoPhotos.score, 93, "2 of 4 photos earns half of 15 points (92.5 rounds to 93)");
equal(fourPhotos.score, 100, "4 photos earns all photo points");
equal(twoPhotos.items.find((item) => item.key === "photos")?.label, "At least 4 photos (2 so far)", "photo label while short");
equal(fourPhotos.items.find((item) => item.key === "photos")?.label, "4 photos", "photo label when done");
equal(buildReadinessChecklist(input({ photoCount: 6 })).items.find((i) => i.key === "photos")?.label, "6 photos", "more photos");

// Individual weights.
equal(buildReadinessChecklist(input({ title: "Charger" })).score, 90, "short title costs 10");
equal(buildReadinessChecklist(input({ price: 0 })).score, 85, "missing price costs 15");
equal(buildReadinessChecklist(input({ description: "Charger." })).score, 85, "thin description costs 15");
equal(buildReadinessChecklist(input({ retakePhotoCount: 1 })).score, 90, "retake costs 10");
equal(buildReadinessChecklist(input({ openQuestionCount: 2 })).score, 90, "open questions cost 10");
equal(buildReadinessChecklist(input({ paymentMethods: "" })).score, 95, "half profile credit");
equal(buildReadinessChecklist(input({ pickupLocation: "", paymentMethods: "" })).score, 90, "no profile credit");

// Description layouts.
equal(hasDetailedDescription(NEW_LAYOUT), true, "new Details:/Condition: layout");
equal(hasDetailedDescription(LEGACY_LAYOUT), true, "legacy emoji layout");
equal(hasDetailedDescription("Condition: Good"), false, "condition alone is not enough");
equal(hasDetailedDescription("x".repeat(160)), true, "long free text counts");

// AI tips split 15 points; off when insights are disabled.
const tips = [
  { text: "Add a close-up photo of the label.", done: false },
  { text: "Mention the cable is included.", done: true },
  { text: "Say why you are selling.", done: false },
];
const withTips = buildReadinessChecklist(input({ tips }));
equal(withTips.score, 90, "one of three tips done: 5 of 15");
const tipItems = withTips.items.filter((item) => item.aiTip);
equal(tipItems.length, 3, "each tip is a row");
equal(tipItems[0].action, "photos", "photo tip opens photos");
equal(tipItems[2].action, "edit", "text tip opens edit");
const insightsOff = buildReadinessChecklist(input({ tips, insightsEnabled: false }));
equal(insightsOff.score, 100, "tips ignored when insights are off");
equal(insightsOff.items.some((item) => item.aiTip), false, "no tip rows when insights are off");

// Labels.
equal(readinessLabel(85), "Ready", "85 ready");
equal(readinessLabel(84), "Almost ready", "84 almost");
equal(readinessLabel(60), "Almost ready", "60 almost");
equal(readinessLabel(59), "Needs work", "59 needs work");
const bare = buildReadinessChecklist(
  input({ title: "", price: 0, description: "", photoCount: 1, pickupLocation: "", paymentMethods: "" }),
);
equal(bare.score, 39, "bare listing score");
equal(bare.label, "Needs work", "bare label");

// Navigation targets.
deepEqual(
  bare.items.filter((item) => !item.done).map((item) => item.action),
  ["edit_title", "edit_price", "edit_description", "photos", "profile"],
  "to-do rows point at the right fix",
);

// Video: an optional, unscored row when there are photos but no video.
const noVideo = buildReadinessChecklist(input());
equal(noVideo.optional.length, 1, "photos without a video suggest one");
equal(noVideo.optional[0].label, "Optional: add a short video", "optional video copy");
equal(noVideo.optional[0].action, "photos", "the video row opens Manage Photos");
equal(noVideo.items.some((item) => item.key === "video"), false, "the video row is not a scored item");
equal(buildReadinessChecklist(input({ hasVideo: true })).optional.length, 0, "no row once there is a video");
equal(buildReadinessChecklist(input({ photoCount: 0 })).optional.length, 0, "no row without photos");
equal(buildReadinessChecklist(input({ hasVideo: true })).score, noVideo.score, "a video does not change the score");

equal(isPhotoTip("Retake the blurry shot"), true, "shot is a photo tip");
equal(isPhotoTip("Add the brand to the title"), false, "title tip is text");

// Tip state persists on the listing quality record.
const quality = qualityWithTips(
  { overall_score: 62, readiness_label: "almost_ready", score_breakdown: { title: 10 }, improvement_suggestions: ["Old"] },
  tips,
  { media: "m1", text: "t1" },
);
deepEqual(quality.improvement_suggestions, tips.map((tip) => tip.text), "tips stored in order");
deepEqual(quality.completed_suggestions, ["Mention the cable is included."], "done tips stored");
equal(quality.checked_media, "m1", "media signature stored");
equal(quality.overall_score, 62, "backend score kept");
deepEqual(tipsFromQuality(quality), tips, "round trip");
deepEqual(tipsFromQuality(null), [], "no quality, no tips");
equal(qualityWithTips(quality, tips).checked_text, "t1", "checked signatures carry over");

// Signatures.
equal(mediaSignature(["a", "b"]) === mediaSignature(["a", "b"]), true, "stable media signature");
equal(mediaSignature(["a", "b"]) === mediaSignature(["b", "a"]), false, "new cover changes signature");
equal(mediaSignature(["a"]) === mediaSignature(["a", "b"]), false, "added photo changes signature");
const text = { title: "T", description: "D", price: 5, condition: "Good", category: "C" };
equal(textSignature(text) === textSignature({ ...text }), true, "stable text signature");
equal(textSignature(text) === textSignature({ ...text, price: 6 }), false, "price edit changes text signature");

// When to re-check (port of needsRecheck).
const base = {
  insightsEnabled: true,
  running: false,
  hasTips: true,
  media: "m",
  text: "t",
  checkedMedia: "m",
  checkedText: "t",
  photoCount: 3,
  canSendPhotos: true,
};
equal(pendingRecheck(base), null, "nothing changed");
deepEqual(pendingRecheck({ ...base, media: "m2" }), { withImages: true }, "photos changed");
deepEqual(pendingRecheck({ ...base, text: "t2" }), { withImages: false }, "text changed");
deepEqual(pendingRecheck({ ...base, media: "m2", text: "t2" }), { withImages: true }, "both changed");
equal(pendingRecheck({ ...base, media: "m2", insightsEnabled: false }), null, "insights off");
equal(pendingRecheck({ ...base, media: "m2", running: true }), null, "already running");
equal(pendingRecheck({ ...base, text: "t2", hasTips: false }), null, "text edit with no open tips");
deepEqual(pendingRecheck({ ...base, media: "m2", hasTips: false }), { withImages: true }, "photo edit still grades photos");
equal(pendingRecheck({ ...base, media: "m2", canSendPhotos: false }), null, "photos the server cannot see");
equal(pendingRecheck({ ...base, media: "m2", photoCount: 0 }), null, "no photos left");

console.log("readiness checklist tests passed");
