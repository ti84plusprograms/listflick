import {
  applyUserProfileToDescription,
  descriptionLayout,
  descriptionWithDetails,
  parseListingDescription,
  stripAppendedDetailsBlock,
} from "../utils/descriptionFormatter";

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function includes(value: string, expected: string, message: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${message}: missing ${JSON.stringify(expected)}`);
  }
}

function excludes(value: string, unexpected: string, message: string): void {
  if (value.includes(unexpected)) {
    throw new Error(`${message}: found ${JSON.stringify(unexpected)}`);
  }
}

const structured = [
  "I am selling a portable Spigen power bank.",
  "",
  "🔹 Features:",
  "- Portable charger",
  "- USB-C input",
  "",
  "💵 Price: $25",
  "",
  "✅ Condition: Like New - no visible defects.",
  "",
  "📍 Pickup Details:",
  "- Location: [Insert Pickup Location]",
  "- Payment: [Insert Payment Methods]",
].join("\n");

const parsed = parseListingDescription(structured);
equal(parsed.askingPrice, "25", "parses asking price");
equal(parsed.condition, "Like New", "parses condition");
equal(parsed.negotiable, false, "parses negotiable state");
equal(parsed.localPickup, false, "ignores pickup placeholder");

const details = {
  askingPrice: "$30 (negotiable)",
  condition: "Good",
  brandModel: "Spigen PowerArc",
  color: "",
  material: "",
  dimensions: "5 x 3 in",
  flaws: "light surface scratches",
  accessories: "USB-C cable",
  preferences: "Local pickup, Shipping available",
};
const updated = descriptionWithDetails(structured, details);

includes(updated, "I am selling a portable Spigen power bank.", "preserves description");
includes(updated, "🔹 Features:\n- Portable charger\n- USB-C input", "preserves feature layout");
includes(updated, "- Brand/model: Spigen PowerArc", "adds brand and model");
includes(updated, "- Dimensions: 5 x 3 in", "adds dimensions");
includes(updated, "- Included accessories: USB-C cable", "adds accessories");
includes(updated, "💵 Price: $30 (negotiable)", "updates price");
includes(updated, "✅ Condition: Good - light surface scratches", "updates condition and flaws");
includes(updated, "- Availability: Local pickup, Shipping available", "updates availability");
excludes(updated, "\n\nDetails:\n", "does not append a legacy details block");

const parsedUpdated = parseListingDescription(updated);
equal(parsedUpdated.brandModel, "Spigen PowerArc", "round-trips brand and model");
equal(parsedUpdated.dimensions, "5 x 3 in", "round-trips dimensions");
equal(parsedUpdated.accessories, "USB-C cable", "round-trips accessories");
equal(parsedUpdated.flaws, "light surface scratches", "round-trips flaws");
equal(parsedUpdated.preferences, "Local pickup, Shipping available", "round-trips preferences");
equal(parsedUpdated.localPickup, true, "detects local pickup");
equal(parsedUpdated.shipping, true, "detects shipping");
equal(descriptionWithDetails(updated, details), updated, "reapplying edits is idempotent");

const withoutAvailability = descriptionWithDetails(updated, {
  ...details,
  askingPrice: "$30",
  preferences: "",
});
excludes(withoutAvailability, "- Availability:", "clearing logistics removes availability");

const withoutFlaws = descriptionWithDetails(updated, {
  ...details,
  askingPrice: "$30",
  flaws: "",
  preferences: "",
});
includes(withoutFlaws, "✅ Condition: Good", "preserves condition when flaws are cleared");
excludes(withoutFlaws, "light surface scratches", "clearing flaws removes old flaw text");

const legacyDetails = `${structured}\n\nDetails:\n- Brand/model: Spigen PowerArc\n- Dimensions: 5 x 3 in`;
equal(stripAppendedDetailsBlock(legacyDetails), structured, "strips legacy managed details");

const userWrittenDetails = "Original description.\n\nDetails:\n- Seller note: stored indoors";
equal(stripAppendedDetailsBlock(userWrittenDetails), userWrittenDetails, "preserves user-written details");

const poorCondition = [
  "I am selling a patio umbrella.",
  "",
  "✅ Condition: poor - Poor - torn canopy and damaged tip",
].join("\n");
const parsedPoorCondition = parseListingDescription(poorCondition);
equal(parsedPoorCondition.condition, "Needs Repair", "normalizes repair condition");
equal(parsedPoorCondition.flaws, "torn canopy and damaged tip", "extracts repair flaws");

const cleanedPoorCondition = descriptionWithDetails(poorCondition, {
  askingPrice: "$15",
  condition: parsedPoorCondition.condition,
  brandModel: "",
  color: "",
  material: "",
  dimensions: "",
  flaws: parsedPoorCondition.flaws,
  accessories: "",
  preferences: "",
});
includes(cleanedPoorCondition, "✅ Condition: Needs Repair - torn canopy and damaged tip", "cleans repair condition");
excludes(cleanedPoorCondition, "Poor - torn", "does not duplicate poor-condition wording");

// ---------------------------------------------------------------------------
// Plain layout (current backend output): no emoji headers, no price line
// ---------------------------------------------------------------------------

const plain = [
  "Apple iPhone 13 in blue, unlocked.",
  "",
  "Details:",
  "- 128GB storage",
  "- Model A2482",
  "- Blue",
  "",
  "Condition: Good. Light scratches on the back glass.",
  "",
  "Pickup in Midtown. Cash or Venmo.",
].join("\n");

equal(descriptionLayout(structured), "legacy", "emoji headers are the legacy layout");
equal(descriptionLayout(plain), "plain", "new descriptions are the plain layout");
equal(descriptionLayout("Just a sentence."), "plain", "free-form text is edited as the plain layout");

const parsedPlain = parseListingDescription(plain);
equal(parsedPlain.askingPrice, "", "plain layout has no price to parse");
equal(parsedPlain.condition, "Good", "parses plain condition");
equal(parsedPlain.flaws, "Light scratches on the back glass.", "parses plain condition detail as flaws");
equal(parsedPlain.localPickup, true, "pickup in the logistics line counts as local pickup");
equal(parsedPlain.shipping, false, "no shipping mentioned");
equal(parsedPlain.negotiable, false, "no offers wording");

const plainDetails = {
  askingPrice: "$300 (negotiable)",
  negotiable: true,
  condition: "Fair",
  brandModel: "Apple iPhone 13",
  color: "",
  material: "",
  dimensions: "",
  flaws: "cracked camera lens",
  accessories: "Clear case",
  preferences: "Local pickup, Shipping available",
};
const plainUpdated = descriptionWithDetails(plain, plainDetails);
equal(
  plainUpdated,
  [
    "Apple iPhone 13 in blue, unlocked.",
    "",
    "Details:",
    "- 128GB storage",
    "- Model A2482",
    "- Blue",
    "- Brand/model: Apple iPhone 13",
    "- Included accessories: Clear case",
    "",
    "Condition: Fair. Cracked camera lens.",
    "",
    "Pickup in Midtown. Cash or Venmo. Shipping available. Open to reasonable offers.",
  ].join("\n"),
  "plain edits keep the layout"
);
excludes(plainUpdated, "$300", "price edits never write a price into the plain layout");
excludes(plainUpdated, "Price:", "no price line in the plain layout");
excludes(plainUpdated, "💵", "no legacy headers are introduced");
equal(descriptionWithDetails(plainUpdated, plainDetails), plainUpdated, "plain edits are idempotent");

const parsedPlainUpdated = parseListingDescription(plainUpdated);
equal(parsedPlainUpdated.brandModel, "Apple iPhone 13", "round-trips plain brand and model");
equal(parsedPlainUpdated.accessories, "Clear case", "round-trips plain accessories");
equal(parsedPlainUpdated.flaws, "Cracked camera lens.", "round-trips plain flaws");
equal(parsedPlainUpdated.negotiable, true, "offers wording reads as negotiable");
equal(parsedPlainUpdated.shipping, true, "round-trips shipping");
equal(parsedPlainUpdated.preferences, "Local pickup, Shipping available", "derives plain preferences");

const plainFirm = descriptionWithDetails(plainUpdated, {
  ...plainDetails,
  negotiable: false,
  flaws: "",
  brandModel: "",
  preferences: "Shipping available",
});
excludes(plainFirm, "Open to reasonable offers.", "turning negotiable off removes the offers sentence");
excludes(plainFirm, "Brand/model:", "clearing brand removes the managed detail line");
excludes(plainFirm, "Pickup in Midtown.", "unchecking pickup removes the pickup sentence");
includes(plainFirm, "Condition: Fair.", "condition stays when flaws are cleared");
excludes(plainFirm, "Cracked camera lens", "clearing flaws removes old flaw text");
includes(plainFirm, "Cash or Venmo. Shipping available.", "payment and shipping stay on one line");

const plainWithPriceEdit = descriptionWithDetails(plain, {
  ...plainDetails,
  askingPrice: "$450",
  negotiable: false,
  condition: "Good",
  brandModel: "",
  accessories: "",
  flaws: "Light scratches on the back glass.",
  preferences: "Local pickup",
});
equal(plainWithPriceEdit, plain, "a price-only edit leaves a plain description unchanged");

const sparse = "Oak desk.";
const sparseUpdated = descriptionWithDetails(sparse, {
  askingPrice: "$60",
  negotiable: false,
  condition: "Good",
  brandModel: "",
  color: "",
  material: "",
  dimensions: "48 x 24 in",
  flaws: "",
  accessories: "",
  preferences: "Local pickup",
});
equal(
  sparseUpdated,
  ["Oak desk.", "", "Details:", "- Dimensions: 48 x 24 in", "", "Condition: Good.", "", "Local pickup."].join("\n"),
  "plain layout builds missing parts in order"
);
equal(parseListingDescription(sparseUpdated).dimensions, "48 x 24 in", "parses dimensions from a built details list");

const placeholderCondition = "Desk.\n\nCondition: [Confirm condition and visible defects]";
equal(parseListingDescription(placeholderCondition).flaws, "", "condition placeholders are not flaws");

equal(
  stripAppendedDetailsBlock(plainUpdated).includes("Brand/model:"),
  false,
  "strips managed plain detail lines"
);
includes(stripAppendedDetailsBlock(plainUpdated), "- 128GB storage", "keeps AI-written plain details");
const plainTrailingDetails = "Oak desk.\n\nDetails:\n- Brand/model: Ikea Lisabo";
equal(
  parseListingDescription(plainTrailingDetails).brandModel,
  "Ikea Lisabo",
  "a trailing plain Details list is not mistaken for the old appended block"
);

const profile = { name: "", username: "", pickupLocation: "Midtown", paymentMethods: "cash or Venmo" };
equal(
  applyUserProfileToDescription("Desk.\n\nCondition: Good.", profile),
  "Desk.\n\nCondition: Good.\n\nPickup in Midtown. Cash or Venmo.",
  "profile fills plain logistics when missing"
);
equal(applyUserProfileToDescription(plain, profile), plain, "profile does not duplicate existing logistics");
includes(
  applyUserProfileToDescription(structured.replace("[Insert Pickup Location]", "[Insert City/Neighborhood]"), profile),
  "- Location: Midtown",
  "profile still fills legacy placeholders"
);

// Seller-written logistics that mix pickup, payment and price terms in one sentence.
{
  const mixed = "Desk.\n\nCondition: Good.\n\nLocal pickup in Midtown, cash or Venmo, open to offers.";
  const parsed = parseListingDescription(mixed);
  const details = {
    askingPrice: "",
    negotiable: parsed.negotiable,
    condition: parsed.condition,
    brandModel: parsed.brandModel,
    color: parsed.color,
    material: parsed.material,
    dimensions: parsed.dimensions,
    flaws: parsed.flaws,
    accessories: parsed.accessories,
    preferences: parsed.preferences,
  };
  const lastLine = (value: string) => value.split("\n").slice(-1)[0];
  equal(
    lastLine(descriptionWithDetails(mixed, { ...details, color: "Brown" })),
    "Local pickup in Midtown, cash or Venmo, open to offers.",
    "unrelated edits keep a mixed logistics sentence as written"
  );
  equal(
    lastLine(descriptionWithDetails(mixed, { ...details, negotiable: false })),
    "Local pickup in Midtown, cash or Venmo.",
    "turning off negotiable removes only the offers clause"
  );
  equal(
    lastLine(descriptionWithDetails(mixed, { ...details, preferences: "" })),
    "Cash or Venmo. Open to offers.",
    "turning off pickup keeps payment and offers"
  );
  const firm = "Desk.\n\nCondition: Good.\n\nPorch pickup in Decatur; price is firm, Venmo or Zelle.";
  equal(
    lastLine(descriptionWithDetails(firm, { ...details, negotiable: true, preferences: "Local pickup" })),
    "Porch pickup in Decatur, Venmo or Zelle. Open to reasonable offers.",
    "switching to negotiable swaps the firm clause for an offers sentence"
  );
}

console.log("Description formatter tests passed.");
