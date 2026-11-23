import type { EditListingFormState } from "../utils/editListingForm";
import {
  applyListingImprovementToForm,
  buildAIImprovementListing,
  createInitialEditListingForm,
  defaultListingQuality,
  descriptionWithFormDetails,
  formToDraftListingEdits,
  listingImprovementHints,
  listingImprovementSummary,
} from "../utils/editListingForm";
import { parseListingDescription } from "../utils/descriptionFormatter";
import type { ListingWorkspaceState, PriceSuggestion } from "../types/listing";

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function baseListing(description: string): ListingWorkspaceState {
  return {
    itemId: "item-1",
    imageUris: [],
    title: "Route title",
    description,
    category: "Route category",
    condition: "Good",
    activePrice: 125,
    activePriceSource: "manual",
    priceSuggestion: null,
    listingQuality: null,
    missingChecklist: [],
    imageQualityFeedback: [],
  };
}

const structured = [
  "Selling a compact desk lamp.",
  "",
  "🔹 Features:",
  "- Adjustable arm",
  "",
  "💵 Price: $45",
  "",
  "✅ Condition: Good - light scuffing",
  "",
  "📍 Pickup Details:",
  "- Location: Downtown",
].join("\n");

const routeForm = createInitialEditListingForm({
  listing: baseListing(structured),
  parsedDescription: parseListingDescription(structured),
  draft: {
    title: "Draft title",
    activePrice: 80,
    brandModel: "Anglepoise Type 75",
    preferences: "Shipping available",
  },
});
equal(routeForm.title, "Draft title", "draft title overrides route title");
equal(routeForm.priceInput, "80", "draft price overrides route and parsed price");
equal(routeForm.brandModel, "Anglepoise Type 75", "draft detail overrides parsed value");
equal(routeForm.localPickup, false, "draft preferences can clear pickup");
equal(routeForm.shipping, true, "draft preferences serialize shipping");

const draftDescription = [
  structured,
  "- Brand/model: Parsed draft brand",
  "- Dimensions: 10 x 5 in",
].join("\n");
const parsedDraftForm = createInitialEditListingForm({
  listing: baseListing(structured),
  parsedDescription: parseListingDescription(structured),
  draft: { description: draftDescription },
});
equal(parsedDraftForm.brandModel, "Parsed draft brand", "parsed draft description fills missing brand");
equal(parsedDraftForm.dimensions, "10 x 5 in", "parsed draft description fills missing dimensions");
equal(parsedDraftForm.priceInput, "45", "parsed draft description fills missing price");

const noLogistics = "Selling a compact desk lamp.";
const defaultPickupForm = createInitialEditListingForm({
  listing: baseListing(noLogistics),
  parsedDescription: parseListingDescription(noLogistics),
  defaults: { defaultLocalPickup: true },
});
equal(defaultPickupForm.localPickup, true, "default pickup applies without draft or logistics");

const logisticsForm = createInitialEditListingForm({
  listing: baseListing(`${noLogistics}\n\n📍 Pickup Details:\n- Availability: Shipping available`),
  defaults: { defaultLocalPickup: true },
});
equal(logisticsForm.localPickup, false, "default pickup does not override existing logistics");
equal(logisticsForm.shipping, true, "existing logistics are preserved");

const draftWithoutLogisticsForm = createInitialEditListingForm({
  listing: baseListing(noLogistics),
  parsedDescription: parseListingDescription(noLogistics),
  draft: {},
  defaults: { defaultLocalPickup: true },
});
equal(draftWithoutLogisticsForm.localPickup, false, "default pickup does not apply when a draft exists");

const repairForm = createInitialEditListingForm({
  listing: baseListing(structured),
  parsedDescription: parseListingDescription(structured),
  draft: { condition: "Poor", flaws: "broken switch" },
});
equal(repairForm.condition, "Needs Repair", "condition normalization uses flaws context");

const serialized = formToDraftListingEdits(
  {
    ...repairForm,
    priceInput: "not a number",
    localPickup: true,
    shipping: true,
  },
  undefined
);
equal(serialized.preferences, "Local pickup, Shipping available", "pickup and shipping serialize to preferences");
equal(serialized.activePrice, 0, "invalid price serializes as zero");
equal(serialized.activePriceSource, "manual", "missing active price source defaults to manual");

const detailsForm: EditListingFormState = {
  ...repairForm,
  priceInput: "60",
  negotiable: true,
  brandModel: "Anglepoise Type 75",
  dimensions: "10 x 5 in",
  accessories: "LED bulb",
  localPickup: true,
  shipping: false,
};
const regenerated = descriptionWithFormDetails(structured, detailsForm);
equal(descriptionWithFormDetails(regenerated, detailsForm), regenerated, "description regeneration is idempotent");

const pricing: PriceSuggestion = {
  min: 40,
  max: 90,
  fast_sale_price: 45,
  recommended_price: 65,
  high_ask_price: 85,
  confidence: 0.8,
  pricing_reason: "Comparable sales",
  pricing_warnings: [],
};
const payload = buildAIImprovementListing(
  { ...detailsForm, priceInput: "" },
  pricing,
  defaultListingQuality()
);
equal(payload.price_suggestion.recommended_price, 65, "AI payload falls back to recommended price");

const explicitPayload = buildAIImprovementListing(
  { ...detailsForm, priceInput: "72" },
  pricing,
  defaultListingQuality()
);
equal(explicitPayload.price_suggestion.recommended_price, 72, "AI payload preserves explicit price");

const preImprovementForm: EditListingFormState = {
  ...detailsForm,
  title: "Vintage Canon Camera",
  description: "A deterministic test listing description.",
  category: "Cameras & Photography",
  brandModel: "",
};
const improvedDescription = [
  "Vintage Canon AE-1 35mm film camera in good used condition.",
  "",
  "🔹 Features:",
  "- Brand/model: Canon AE-1",
].join("\n");
const appliedImprovement = applyListingImprovementToForm(
  preImprovementForm,
  {
    ...explicitPayload,
    title: "Vintage Canon AE-1 35mm Film Camera",
    description: improvedDescription,
    marketplace_category: "Cameras & Photography",
  },
  improvedDescription
);
equal(appliedImprovement.form.brandModel, "Canon AE-1", "AI improvement fills the visible brand/model field");
equal(
  appliedImprovement.form.title,
  "Vintage Canon AE-1 35mm Film Camera",
  "AI improvement updates the title field"
);
equal(
  listingImprovementSummary(appliedImprovement.changedFields),
  "AI updated Brand / Model, title, and description.",
  "AI improvement names the fields it changed"
);

const currentChecklistHints = listingImprovementHints(
  [
    { key: "brand", label: "Brand", status: "uncertain" },
    { key: "model", label: "Model", status: "missing", reason: "Model is missing." },
    { key: "dimensions", label: "Dimensions", status: "missing", reason: "Dimensions are missing." },
  ],
  true
);
equal(currentChecklistHints.buyerTrust?.key, "model", "current model key exposes buyer trust suggestion");
equal(
  currentChecklistHints.descriptionDetails?.key,
  "dimensions",
  "current dimensions key exposes description suggestion"
);
equal(
  listingImprovementHints([{ key: "brand_model", label: "Brand", status: "missing" }], true).buyerTrust?.key,
  "brand_model",
  "legacy composite key remains supported"
);
equal(
  listingImprovementHints([{ key: "model", label: "Model", status: "missing" }], false).buyerTrust,
  undefined,
  "disabled insights hide improvement suggestions"
);

console.log("Edit listing form tests passed.");
