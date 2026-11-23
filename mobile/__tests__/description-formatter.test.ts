import {
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

console.log("Description formatter tests passed.");
