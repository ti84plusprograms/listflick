import type { ListingQuality } from "../types/listing";

/**
 * The live "Ready to list" checklist. Every item is computed from the listing as
 * it is right now, so the score moves as soon as the seller adds photos, sets a
 * price or edits the text. Only the AI tips need a model call to tick off
 * (see hooks/useListingRecheck).
 */

export interface ListingTip {
  text: string;
  done: boolean;
}

export type ChecklistAction =
  | "edit_title"
  | "edit_price"
  | "edit_description"
  | "edit"
  | "photos"
  | "questions"
  | "profile";

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  weight: number;
  /** Partial credit (0-1) while not done. */
  partial?: number;
  action: ChecklistAction;
  aiTip?: boolean;
}

export type ReadinessLabel = "Ready" | "Almost ready" | "Needs work";

export interface ReadinessChecklist {
  items: ChecklistItem[];
  /** Suggestions that never count toward the score (e.g. adding a video). */
  optional: ChecklistItem[];
  score: number;
  label: ReadinessLabel;
}

export const OPTIONAL_VIDEO_LABEL = "Optional: add a short video";

export interface ReadinessInput {
  title: string;
  description: string;
  price: number;
  photoCount: number;
  retakePhotoCount: number;
  openQuestionCount: number;
  pickupLocation: string;
  paymentMethods: string;
  insightsEnabled: boolean;
  tips: ListingTip[];
  /** The listing already has its one video. */
  hasVideo?: boolean;
}

export const MIN_PHOTOS = 4;
const PHOTO_TIP = /photo|picture|pic\b|shot|angle|image|lighting|label|close-?up|background|video/i;
// "Details:" is the new plain layout; "🔹 Features:" is the older emoji layout.
const DETAILS_SECTION = /(^|\n)\s*(?:🔹\s*)?(?:details|features)\s*:/i;
const CONDITION_SECTION = /condition\s*:/i;

export function isPhotoTip(text: string): boolean {
  return PHOTO_TIP.test(text);
}

export function hasDetailedDescription(description: string): boolean {
  const text = description.trim();
  return (DETAILS_SECTION.test(text) && CONDITION_SECTION.test(text)) || text.length >= 160;
}

export function readinessLabel(score: number): ReadinessLabel {
  if (score >= 85) return "Ready";
  if (score >= 60) return "Almost ready";
  return "Needs work";
}

export function buildReadinessChecklist(input: ReadinessInput): ReadinessChecklist {
  const n = input.photoCount;
  const hasPickup = Boolean(input.pickupLocation.trim());
  const hasPayment = Boolean(input.paymentMethods.trim());
  const items: (ChecklistItem & { hidden?: boolean })[] = [
    { key: "title", label: "Clear, searchable title", done: input.title.trim().length >= 12, weight: 10, action: "edit_title" },
    { key: "price", label: "Price set", done: input.price > 0, weight: 15, action: "edit_price" },
    {
      key: "description",
      label: "Description with details and condition",
      done: hasDetailedDescription(input.description),
      weight: 15,
      action: "edit_description",
    },
    {
      key: "photos",
      label: n >= MIN_PHOTOS ? `${n} photos` : `At least ${MIN_PHOTOS} photos (${n} so far)`,
      done: n >= MIN_PHOTOS,
      partial: Math.min(1, n / MIN_PHOTOS),
      weight: 15,
      action: "photos",
    },
    { key: "retake", label: "No photos that need a retake", done: input.retakePhotoCount === 0, weight: 10, action: "photos" },
    { key: "questions", label: "Buyer questions answered", done: input.openQuestionCount === 0, weight: 10, action: "questions" },
    {
      key: "profile",
      label: "Pickup area and payment methods",
      done: hasPickup && hasPayment,
      partial: (hasPickup ? 0.5 : 0) + (hasPayment ? 0.5 : 0),
      weight: 10,
      action: "profile",
    },
  ];

  const tips = input.insightsEnabled ? input.tips : [];
  if (tips.length) {
    tips.forEach((tip, index) =>
      items.push({
        key: `tip-${index}`,
        label: tip.text,
        done: tip.done,
        weight: 15 / tips.length,
        action: isPhotoTip(tip.text) ? "photos" : "edit",
        aiTip: true,
      }),
    );
  } else {
    items.push({ key: "tips", label: "AI suggestions", done: true, weight: 15, action: "edit", hidden: true });
  }

  const raw = items.reduce((sum, item) => sum + item.weight * (item.done ? 1 : item.partial ?? 0), 0);
  const score = Math.min(100, Math.round(raw));
  // A short video helps but is never required, so it is a separate, unscored row.
  const optional: ChecklistItem[] = n > 0 && !input.hasVideo
    ? [{ key: "video", label: OPTIONAL_VIDEO_LABEL, done: false, weight: 0, action: "photos" }]
    : [];
  return {
    items: items.filter((item) => !item.hidden).map(({ hidden: _hidden, ...item }) => item),
    optional,
    score,
    label: readinessLabel(score),
  };
}

export function tipsFromQuality(quality: ListingQuality | null | undefined): ListingTip[] {
  const done = new Set(quality?.completed_suggestions ?? []);
  return (quality?.improvement_suggestions ?? [])
    .filter((text) => typeof text === "string" && text.trim())
    .map((text) => ({ text, done: done.has(text) }));
}

/** Store re-checked tips on the listing's quality record so they persist with it. */
export function qualityWithTips(
  quality: ListingQuality | null | undefined,
  tips: ListingTip[],
  checked: { media?: string; text?: string } = {},
): ListingQuality {
  return {
    overall_score: quality?.overall_score ?? 0,
    readiness_label: quality?.readiness_label ?? "needs_work",
    score_breakdown: quality?.score_breakdown ?? {},
    ...quality,
    improvement_suggestions: tips.map((tip) => tip.text),
    completed_suggestions: tips.filter((tip) => tip.done).map((tip) => tip.text),
    checked_media: checked.media ?? quality?.checked_media,
    checked_text: checked.text ?? quality?.checked_text,
  };
}

/** Changes when photos are added, removed or reordered (the cover is photo 1). */
export function mediaSignature(imageUris: string[]): string {
  return `${imageUris.length}:${hashString(imageUris.join("|"))}`;
}

export function textSignature(fields: {
  title: string;
  description: string;
  price: number;
  condition: string;
  category: string;
}): string {
  return hashString(JSON.stringify([fields.title, fields.description, fields.price, fields.condition, fields.category]));
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export type RecheckKind = { withImages: boolean } | null;

/** Port of needsRecheck: what (if anything) must be re-checked right now. */
export function pendingRecheck(input: {
  insightsEnabled: boolean;
  running: boolean;
  hasTips: boolean;
  media: string;
  text: string;
  checkedMedia: string;
  checkedText: string;
  photoCount: number;
  canSendPhotos: boolean;
}): RecheckKind {
  if (!input.insightsEnabled || input.running) return null;
  const mediaChanged = input.media !== input.checkedMedia;
  const textChanged = input.text !== input.checkedText;
  if (!mediaChanged && !textChanged) return null;
  const withImages = mediaChanged && input.photoCount > 0 && input.canSendPhotos;
  // Photo changes the server cannot see yet wait for the next text change or upload.
  if (!withImages && !textChanged) return null;
  // Text-only changes with no open tips to tick off have nothing to re-check.
  if (!withImages && !input.hasTips) return null;
  return { withImages };
}
