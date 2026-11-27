import type {
  ActivePriceSource,
  ChecklistItem,
  DraftListingEdits,
  GeneratedListing,
  ListingDefaults,
  ImprovementAction,
  ListingQuality,
  ListingWorkspaceState,
  PriceSuggestion,
} from "../types/listing";
import {
  descriptionWithDetails,
  normalizeListingCondition,
  parseListingDescription,
  type DescriptionDetails,
  type ParsedListingDescription,
} from "./descriptionFormatter";

export interface EditListingFormState {
  title: string;
  priceInput: string;
  description: string;
  category: string;
  condition: string;
  negotiable: boolean;
  brandModel: string;
  color: string;
  material: string;
  dimensions: string;
  flaws: string;
  accessories: string;
  localPickup: boolean;
  shipping: boolean;
}

export interface AppliedListingImprovement {
  form: EditListingFormState;
  changedFields: string[];
}

export function defaultListingQuality(): ListingQuality {
  return {
    overall_score: 0,
    readiness_label: "needs_work",
    score_breakdown: {},
    improvement_suggestions: [],
  };
}

const BUYER_TRUST_CHECKLIST_KEYS = ["brand_model", "brand", "model"] as const;
const DESCRIPTION_DETAILS_CHECKLIST_KEYS = [
  "description_details",
  "dimensions",
  "flaws",
  "included_accessories",
  "pickup_shipping",
] as const;

function firstMissingChecklistItem(
  checklist: ChecklistItem[],
  keys: readonly string[]
): ChecklistItem | undefined {
  return checklist.find((item) => keys.includes(item.key) && item.status === "missing");
}

export function listingImprovementHints(
  checklist: ChecklistItem[],
  enabled: boolean
): { buyerTrust?: ChecklistItem; descriptionDetails?: ChecklistItem } {
  if (!enabled) return {};
  return {
    buyerTrust: firstMissingChecklistItem(checklist, BUYER_TRUST_CHECKLIST_KEYS),
    descriptionDetails: firstMissingChecklistItem(checklist, DESCRIPTION_DETAILS_CHECKLIST_KEYS),
  };
}

export function formattedAskingPrice(value: string, negotiable: boolean): string {
  const trimmed = value.trim().replace(/^\$/, "");
  if (!trimmed) return "";
  return negotiable ? `$${trimmed} (negotiable)` : `$${trimmed}`;
}

export function preferencesFromForm(form: Pick<EditListingFormState, "localPickup" | "shipping">): string {
  const preferences = [];
  if (form.localPickup) preferences.push("Local pickup");
  if (form.shipping) preferences.push("Shipping available");
  return preferences.join(", ");
}

export function descriptionDetailsFromForm(form: EditListingFormState): DescriptionDetails {
  return {
    askingPrice: formattedAskingPrice(form.priceInput, form.negotiable),
    negotiable: form.negotiable,
    condition: normalizeListingCondition(form.condition, form.flaws) || form.condition.trim(),
    brandModel: form.brandModel.trim(),
    color: form.color.trim(),
    material: form.material.trim(),
    dimensions: form.dimensions.trim(),
    flaws: form.flaws.trim(),
    accessories: form.accessories.trim(),
    preferences: preferencesFromForm(form),
  };
}

export function descriptionWithFormDetails(description: string, form: EditListingFormState): string {
  return descriptionWithDetails(description, descriptionDetailsFromForm(form));
}

export function applyListingImprovementToForm(
  current: EditListingFormState,
  listing: GeneratedListing,
  finalDescription: string
): AppliedListingImprovement {
  const parsedDescription = parseListingDescription(finalDescription);
  const next: EditListingFormState = {
    ...current,
    title: listing.title,
    description: finalDescription,
    category: listing.marketplace_category,
    brandModel: parsedDescription.brandModel || current.brandModel,
  };
  const changedFields = [
    current.brandModel !== next.brandModel ? "Brand / Model" : "",
    current.title !== next.title ? "title" : "",
    current.description !== next.description ? "description" : "",
    current.category !== next.category ? "category" : "",
  ].filter(Boolean);

  return { form: next, changedFields };
}

export function listingImprovementSummary(changedFields: string[]): string {
  if (changedFields.length === 0) return "AI did not change any listing fields.";
  if (changedFields.length === 1) return `AI updated ${changedFields[0]}.`;
  if (changedFields.length === 2) {
    return `AI updated ${changedFields[0]} and ${changedFields[1]}.`;
  }
  return `AI updated ${changedFields.slice(0, -1).join(", ")}, and ${changedFields[changedFields.length - 1]}.`;
}

export function createInitialEditListingForm(input: {
  listing: ListingWorkspaceState;
  parsedDescription?: ParsedListingDescription;
  draft?: DraftListingEdits | null;
  defaults?: ListingDefaults | null;
}): EditListingFormState {
  const { listing, draft, defaults } = input;
  const parsedDescription = input.parsedDescription ?? parseListingDescription(listing.description);
  const form: EditListingFormState = {
    title: listing.title,
    priceInput: String(listing.activePrice || parsedDescription.askingPrice || ""),
    description: listing.description,
    category: listing.category,
    condition: normalizeListingCondition(parsedDescription.condition || listing.condition) || "Good",
    negotiable: parsedDescription.negotiable,
    brandModel: parsedDescription.brandModel,
    color: parsedDescription.color,
    material: parsedDescription.material,
    dimensions: parsedDescription.dimensions,
    flaws: parsedDescription.flaws,
    accessories: parsedDescription.accessories,
    localPickup: parsedDescription.localPickup,
    shipping: parsedDescription.shipping,
  };

  const descriptionHasLogistics =
    parsedDescription.localPickup ||
    parsedDescription.shipping ||
    parsedDescription.preferences.trim().length > 0;

  if (!draft) {
    if (defaults?.defaultLocalPickup && !descriptionHasLogistics) {
      form.localPickup = true;
    }
    return form;
  }

  const parsedDraftDescription =
    typeof draft.description === "string" ? parseListingDescription(draft.description) : null;

  if (typeof draft.title === "string") form.title = draft.title;
  if (typeof draft.activePrice === "number") {
    form.priceInput = String(draft.activePrice);
  } else if (parsedDraftDescription?.askingPrice) {
    form.priceInput = parsedDraftDescription.askingPrice;
  }
  if (typeof draft.description === "string") form.description = draft.description;
  if (typeof draft.category === "string") form.category = draft.category;
  if (typeof draft.condition === "string") {
    form.condition = normalizeListingCondition(draft.condition, draft.flaws) || draft.condition;
  } else if (parsedDraftDescription?.condition) {
    form.condition =
      normalizeListingCondition(parsedDraftDescription.condition) || parsedDraftDescription.condition;
  }
  if (typeof draft.negotiable === "boolean") {
    form.negotiable = draft.negotiable;
  } else if (parsedDraftDescription) {
    form.negotiable = parsedDraftDescription.negotiable;
  }
  if (typeof draft.brandModel === "string") form.brandModel = draft.brandModel;
  else if (parsedDraftDescription?.brandModel) form.brandModel = parsedDraftDescription.brandModel;
  if (typeof draft.color === "string") form.color = draft.color;
  else if (parsedDraftDescription?.color) form.color = parsedDraftDescription.color;
  if (typeof draft.material === "string") form.material = draft.material;
  else if (parsedDraftDescription?.material) form.material = parsedDraftDescription.material;
  if (typeof draft.dimensions === "string") form.dimensions = draft.dimensions;
  else if (parsedDraftDescription?.dimensions) form.dimensions = parsedDraftDescription.dimensions;
  if (typeof draft.flaws === "string") form.flaws = draft.flaws;
  else if (parsedDraftDescription?.flaws) form.flaws = parsedDraftDescription.flaws;
  if (typeof draft.accessories === "string") form.accessories = draft.accessories;
  else if (parsedDraftDescription?.accessories) form.accessories = parsedDraftDescription.accessories;
  if (typeof draft.preferences === "string") {
    const preferences = draft.preferences.toLowerCase();
    form.localPickup = preferences.includes("pickup");
    form.shipping = preferences.includes("ship");
  } else if (parsedDraftDescription) {
    const parsedPreferences = parsedDraftDescription.preferences.toLowerCase();
    form.localPickup = parsedDraftDescription.localPickup || parsedPreferences.includes("pickup");
    form.shipping = parsedDraftDescription.shipping || parsedPreferences.includes("ship");
  }

  return form;
}

export function formToDraftListingEdits(
  form: EditListingFormState,
  activePriceSource: ActivePriceSource | undefined
): DraftListingEdits {
  const price = Number(form.priceInput);
  return {
    title: form.title.trim(),
    description: form.description,
    category: form.category.trim(),
    condition: normalizeListingCondition(form.condition, form.flaws) || form.condition.trim(),
    activePrice: Number.isFinite(price) ? price : 0,
    activePriceSource: activePriceSource ?? "manual",
    negotiable: form.negotiable,
    brandModel: form.brandModel.trim(),
    color: form.color.trim(),
    material: form.material.trim(),
    dimensions: form.dimensions.trim(),
    flaws: form.flaws.trim(),
    accessories: form.accessories.trim(),
    preferences: preferencesFromForm(form),
  };
}

export function formToWorkspaceDetails(form: EditListingFormState): Pick<
  ListingWorkspaceState,
  "title" | "description" | "category" | "condition"
> {
  return {
    title: form.title.trim(),
    description: form.description,
    category: form.category.trim(),
    condition: normalizeListingCondition(form.condition, form.flaws) || form.condition.trim(),
  };
}

export function formToWorkspacePricing(
  form: EditListingFormState,
  activePriceSource: ActivePriceSource | undefined
): Pick<ListingWorkspaceState, "activePrice" | "activePriceSource"> {
  const price = Number(form.priceInput);
  return {
    activePrice: Number.isFinite(price) ? price : 0,
    activePriceSource: activePriceSource ?? "manual",
  };
}

export function buildAIImprovementListing(
  form: EditListingFormState,
  pricing: PriceSuggestion | null | undefined,
  listingQuality: ListingQuality | null | undefined
): GeneratedListing {
  const price = Number(form.priceInput) || pricing?.recommended_price || 0;
  return {
    title: form.title,
    description: form.description,
    marketplace_category: form.category,
    tags: [],
    price_suggestion: {
      min: pricing?.min || pricing?.fast_sale_price || price,
      max: pricing?.max || pricing?.high_ask_price || price,
      fast_sale_price: pricing?.fast_sale_price || pricing?.min || price,
      recommended_price: price,
      high_ask_price: pricing?.high_ask_price || pricing?.max || price,
      confidence: pricing?.confidence ?? 0,
      pricing_reason: pricing?.pricing_reason ?? "",
      pricing_warnings: pricing?.pricing_warnings ?? [],
    },
    listing_quality: listingQuality ?? defaultListingQuality(),
  };
}

export type ImprovementSnapshot = { title: string; description: string; price: string };

/** Short, honest note on what an AI improvement actually changed. */
export function improvementSummary(
  action: ImprovementAction,
  before: ImprovementSnapshot,
  after: ImprovementSnapshot
): string {
  if (action === "make_price_more_competitive") {
    return after.price && after.price !== before.price
      ? `Price lowered to $${after.price} to sell faster.`
      : "The price already looks competitive, so it stayed the same.";
  }
  const titleChanged = after.title.trim() !== before.title.trim();
  const descriptionChanged = after.description.trim() !== before.description.trim();
  if (!titleChanged && !descriptionChanged) return "No changes were needed.";
  const changed = titleChanged && descriptionChanged ? "Title and description" : titleChanged ? "Title" : "Description";
  const how: Record<Exclude<ImprovementAction, "make_price_more_competitive">, string> = {
    make_title_more_searchable: "rewritten so buyers can find it in search",
    make_description_shorter: "shortened, keeping the key details",
    make_description_more_casual: "rewritten in a more casual tone",
    make_description_more_professional: "rewritten in a more polished tone",
    add_condition_details: "updated with condition details",
    improve_buyer_trust: "reworded to be clearer and more upfront",
    generate_platform_ready_version: "polished for Marketplace",
  };
  return `${changed} ${how[action]}. Check it over before you save.`;
}
