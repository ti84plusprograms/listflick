import type { UserProfile } from "../types/listing";

const LEGACY_DETAILS_MARKER = "\n\nDetails:\n";
const LEGACY_DETAIL_LABELS = [
  "Listing title",
  "Category",
  "Asking price",
  "Condition",
  "Brand/model",
  "Color",
  "Material",
  "Dimensions",
  "Flaws/damage",
  "Included accessories",
  "Pickup/shipping/payment",
];

const SECTION = {
  features: "🔹 Features:",
  price: "💵 Price:",
  condition: "✅ Condition:",
  pickup: "📍 Pickup Details:",
} as const;

export const CONDITION_OPTIONS = ["New", "Like New", "Good", "Fair", "Needs Repair"] as const;

const CONDITION_ALIASES = [
  "Needs Repair",
  "Like New",
  "New",
  "Good",
  "Fair",
  "Poor",
  "Bad",
  "Used",
  "Pre-owned",
  "Pre owned",
  "Worn",
  "Heavily used",
  "Broken",
  "Damaged",
];

const REPAIR_WORDS = [
  "broken",
  "cracked",
  "damaged",
  "does not work",
  "doesn't work",
  "missing",
  "needs repair",
  "not working",
  "repair",
  "torn",
];

const FEATURE_LABELS = ["Brand/model", "Color", "Material", "Dimensions", "Included accessories"];

export type DescriptionDetails = {
  askingPrice?: string;
  condition?: string;
  brandModel: string;
  color: string;
  material: string;
  dimensions: string;
  flaws: string;
  accessories: string;
  preferences: string;
};

export type ParsedListingDescription = {
  askingPrice: string;
  negotiable: boolean;
  condition: string;
  brandModel: string;
  color: string;
  material: string;
  dimensions: string;
  flaws: string;
  accessories: string;
  preferences: string;
  localPickup: boolean;
  shipping: boolean;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasRepairSignal(value: string): boolean {
  const lower = value.toLowerCase();
  return REPAIR_WORDS.some((word) => lower.includes(word));
}

export function normalizeListingCondition(value: string | undefined | null, context = ""): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";

  const combined = `${raw} ${context}`.trim();
  const normalized = raw.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

  if (/\bnew\b/.test(normalized) && !/\blike\s+new\b/.test(normalized)) return "New";
  if (/\blike\s+new\b|\bexcellent\b|\bmint\b/.test(normalized)) return "Like New";
  if (/\bneeds?\s+repair\b|\bfor\s+parts\b|\bnot\s+working\b|\bbroken\b/.test(normalized)) return "Needs Repair";
  if (/\bgood\b|\bused\b|\bpre[-\s]?owned\b/.test(normalized)) return "Good";
  if (/\bfair\b/.test(normalized)) return "Fair";
  if (/\bpoor\b|\bbad\b|\bheavily\s+used\b|\bworn\b/.test(normalized)) {
    return hasRepairSignal(combined) ? "Needs Repair" : "Fair";
  }

  return "";
}

function normalizeSpacing(description: string): string {
  return description
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isLegacyManagedDetailsBlock(block: string): boolean {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    lines.length > 0 &&
    lines.every((line) =>
      LEGACY_DETAIL_LABELS.some((label) => line.startsWith(`- ${label}:`))
    )
  );
}

function stripLegacyDetailsBlock(description: string): string {
  let stripped = description.trimEnd();

  while (true) {
    const idx = stripped.lastIndexOf(LEGACY_DETAILS_MARKER);
    if (idx === -1) return stripped.trim();

    const block = stripped.substring(idx + LEGACY_DETAILS_MARKER.length);
    if (!isLegacyManagedDetailsBlock(block)) return stripped.trim();

    stripped = stripped.substring(0, idx).trimEnd();
  }
}

function sectionIndex(lines: string[], matcher: (line: string) => boolean): number {
  return lines.findIndex((line) => matcher(line.trim()));
}

function isFeaturesHeading(line: string): boolean {
  return /^🔹\s*Features:\s*$/i.test(line);
}

function isPriceLine(line: string): boolean {
  return /^💵\s*Price:\s*/i.test(line);
}

function isConditionLine(line: string): boolean {
  return /^✅\s*Condition:\s*/i.test(line);
}

function isPickupHeading(line: string): boolean {
  return /^📍\s*Pickup Details:\s*$/i.test(line);
}

function isKnownSectionLine(line: string): boolean {
  return isFeaturesHeading(line) || isPriceLine(line) || isConditionLine(line) || isPickupHeading(line);
}

function insertionEnd(lines: string[], start: number): number {
  let end = start + 1;
  while (end < lines.length && !isKnownSectionLine(lines[end].trim())) {
    end += 1;
  }
  return end;
}

function cleanPrice(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("$") ? trimmed : `$${trimmed}`;
}

function managedFeatureLine(label: string, value: string): string {
  return `- ${label}: ${value.trim()}`;
}

function removeManagedFeatureLines(lines: string[]): string[] {
  return lines.filter((line) => {
    const trimmed = line.trim();
    return !FEATURE_LABELS.some((label) =>
      new RegExp(`^[•·\\-–—]\\s*${escapeRegex(label)}:`, "i").test(trimmed)
    );
  });
}

function detectBulletPrefix(lines: string[]): string {
  for (const line of lines) {
    const match = line.match(/^(\s*[•·\-–—]\s*)/);
    if (match) return match[1];
  }
  return "- ";
}

function upsertFeaturesSection(lines: string[], details: DescriptionDetails): string[] {
  const featuresIndex = sectionIndex(lines, isFeaturesHeading);

  // Detect bullet style from existing feature lines
  const featureContentLines = featuresIndex >= 0
    ? lines.slice(featuresIndex + 1, insertionEnd(lines, featuresIndex))
    : [];
  const bullet = detectBulletPrefix(featureContentLines);

  const managedLines = [
    details.brandModel.trim() ? `${bullet}${FEATURE_LABELS[0]}: ${details.brandModel.trim()}` : "",
    details.color.trim() ? `${bullet}${FEATURE_LABELS[1]}: ${details.color.trim()}` : "",
    details.material.trim() ? `${bullet}${FEATURE_LABELS[2]}: ${details.material.trim()}` : "",
    details.dimensions.trim() ? `${bullet}${FEATURE_LABELS[3]}: ${details.dimensions.trim()}` : "",
    details.accessories.trim() ? `${bullet}${FEATURE_LABELS[4]}: ${details.accessories.trim()}` : "",
  ].filter(Boolean);

  if (featuresIndex === -1) {
    if (managedLines.length === 0) return lines;
    const priceIndex = sectionIndex(lines, isPriceLine);
    const insertAt = priceIndex >= 0 ? priceIndex : Math.min(lines.length, 2);
    const next = [...lines];
    next.splice(insertAt, 0, SECTION.features, ...managedLines, "");
    return next;
  }

  const end = insertionEnd(lines, featuresIndex);
  // Strip trailing blank lines from existing content so managed lines sit right after
  let existingFeatureLines = removeManagedFeatureLines(lines.slice(featuresIndex + 1, end));
  while (existingFeatureLines.length > 0 && existingFeatureLines[existingFeatureLines.length - 1].trim() === "") {
    existingFeatureLines.pop();
  }
  return [
    ...lines.slice(0, featuresIndex + 1),
    ...existingFeatureLines,
    ...managedLines,
    "",
    ...lines.slice(end),
  ];
}

function upsertPriceSection(lines: string[], askingPrice: string): string[] {
  const price = cleanPrice(askingPrice);
  if (!price) return lines;

  const priceLine = `${SECTION.price} ${price}`;
  const withoutSuggested = lines.filter((line) => !/\bsuggested\s+(?:price\s+)?(?:range|price)\b/i.test(line));
  const priceIndex = sectionIndex(withoutSuggested, isPriceLine);
  if (priceIndex >= 0) {
    const next = [...withoutSuggested];
    next[priceIndex] = priceLine;
    return next;
  }

  const conditionIndex = sectionIndex(withoutSuggested, isConditionLine);
  const pickupIndex = sectionIndex(withoutSuggested, isPickupHeading);
  const insertAt = conditionIndex >= 0 ? conditionIndex : pickupIndex >= 0 ? pickupIndex : withoutSuggested.length;
  const next = [...withoutSuggested];
  next.splice(insertAt, 0, priceLine, "");
  return next;
}

function conditionPattern(): string {
  return CONDITION_ALIASES.map(escapeRegex).join("|");
}

function conditionRemainder(existingValue: string): string {
  let remainder = existingValue.trim();
  for (let i = 0; i < 3; i += 1) {
    const next = remainder
      .replace(new RegExp(`^\\s*(?:${conditionPattern()})(?:\\s+condition)?(?:\\s*[-:–—,!.]\\s*|\\s*$)`, "i"), "")
      .trim();
    if (next === remainder) break;
    remainder = next;
  }
  return remainder
    .trim();
}

function isBenignConditionDetail(value: string): boolean {
  return /\b(no visible defects|no flaws|no damage|excellent condition)\b/i.test(value);
}

function upsertConditionSection(lines: string[], condition: string, flaws: string): string[] {
  const normalizedCondition = normalizeListingCondition(condition, flaws) || condition.trim();
  if (!normalizedCondition && !flaws.trim()) return lines;

  const conditionIndex = sectionIndex(lines, isConditionLine);
  const conditionPrefix = `${SECTION.condition} `;
  const fallbackValue = [normalizedCondition, flaws.trim()].filter(Boolean).join(" - ");

  if (conditionIndex === -1) {
    const pickupIndex = sectionIndex(lines, isPickupHeading);
    const insertAt = pickupIndex >= 0 ? pickupIndex : lines.length;
    const next = [...lines];
    next.splice(insertAt, 0, `${conditionPrefix}${fallbackValue}`, "");
    return next;
  }

  const match = lines[conditionIndex].match(/^(✅\s*Condition:\s*)(.*)$/i);
  const existingRemainder = conditionRemainder(match?.[2] ?? "");
  const detailText = flaws.trim() || (isBenignConditionDetail(existingRemainder) ? existingRemainder : "");
  const next = [...lines];
  next[conditionIndex] = detailText
    ? `${match?.[1] ?? conditionPrefix}${normalizedCondition || "Condition"} - ${detailText}`
    : `${match?.[1] ?? conditionPrefix}${normalizedCondition}`;
  return next;
}

function upsertPickupSection(lines: string[], preferences: string): string[] {
  const trimmedPreferences = preferences.trim();
  const availabilityLine = `- Availability: ${trimmedPreferences}`;
  const pickupIndex = sectionIndex(lines, isPickupHeading);
  if (pickupIndex === -1 && trimmedPreferences) {
    return [...lines, "", SECTION.pickup, availabilityLine];
  }
  if (pickupIndex === -1) return lines;

  const end = insertionEnd(lines, pickupIndex);
  const existing = lines
    .slice(pickupIndex + 1, end)
    .filter((line) => !/^\s*[-•]\s*Availability:\s*/i.test(line));

  if (!trimmedPreferences) {
    return [
      ...lines.slice(0, pickupIndex + 1),
      ...existing,
      ...lines.slice(end),
    ];
  }

  return [
    ...lines.slice(0, pickupIndex + 1),
    ...existing,
    availabilityLine,
    ...lines.slice(end),
  ];
}

function extractPrice(value: string): string {
  const match = value.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  return match ? match[1] : "";
}

function extractCondition(value: string): string {
  const match = value.match(new RegExp(`\\b(${conditionPattern()})\\b`, "i"));
  if (!match) return "";
  return normalizeListingCondition(match[1], value);
}

function extractManagedFeature(lines: string[], label: string): string {
  const match = lines
    .map((line) => line.trim())
    .find((line) => line.startsWith(`- ${label}:`));
  return match ? match.substring(`- ${label}:`.length).trim() : "";
}

function extractAvailability(lines: string[]): string {
  const match = lines
    .map((line) => line.trim())
    .find((line) => /^\s*[-•]\s*Availability:\s*/i.test(line));
  return match ? match.replace(/^\s*[-•]\s*Availability:\s*/i, "").trim() : "";
}

function extractConditionDetail(conditionLine: string): string {
  const match = conditionLine.match(/^✅\s*Condition:\s*(.*)$/i);
  if (!match) return "";
  const detail = conditionRemainder(match[1]);
  return isBenignConditionDetail(detail) ? "" : detail;
}

export function parseListingDescription(description: string): ParsedListingDescription {
  const clean = stripLegacyDetailsBlock(description);
  const lines = clean.split("\n").map((line) => line.trim());
  const priceLine = lines.find(isPriceLine) ?? "";
  const conditionLine = lines.find(isConditionLine) ?? "";
  const preferences = extractAvailability(lines);
  const lower = clean.toLowerCase();

  return {
    askingPrice: extractPrice(priceLine),
    negotiable: /\bnegotiable\b/i.test(priceLine),
    condition: extractCondition(conditionLine),
    brandModel: extractManagedFeature(lines, "Brand/model"),
    color: extractManagedFeature(lines, "Color"),
    material: extractManagedFeature(lines, "Material"),
    dimensions: extractManagedFeature(lines, "Dimensions"),
    flaws: extractManagedFeature(lines, "Flaws/damage") || extractConditionDetail(conditionLine),
    accessories: extractManagedFeature(lines, "Included accessories"),
    preferences,
    localPickup: /\b(local pickup|porch pickup|pickup only|pick up available|meetup|meet up)\b/i.test(preferences || lower),
    shipping: /\b(shipping|ship available|ships|can ship)\b/i.test(preferences || lower),
  };
}

export function descriptionWithDetails(
  baseDescription: string,
  details: DescriptionDetails
): string {
  const clean = stripLegacyDetailsBlock(baseDescription);
  let lines = normalizeSpacing(clean).split("\n");

  lines = upsertFeaturesSection(lines, details);
  lines = upsertPriceSection(lines, details.askingPrice ?? "");
  lines = upsertConditionSection(lines, details.condition ?? "", details.flaws);
  lines = upsertPickupSection(lines, details.preferences);

  return normalizeSpacing(lines.join("\n"));
}

export function stripAppendedDetailsBlock(description: string): string {
  let clean = stripLegacyDetailsBlock(description);
  let lines = clean.split("\n");

  // Remove only managed feature lines (Brand/model, Color, etc.) — keep AI-written bullets
  const featuresIdx = sectionIndex(lines, isFeaturesHeading);
  if (featuresIdx >= 0) {
    const end = insertionEnd(lines, featuresIdx);
    const kept = removeManagedFeatureLines(lines.slice(featuresIdx + 1, end));
    lines.splice(featuresIdx + 1, end - featuresIdx - 1, ...kept);
  }

  // Remove only the Availability line from Pickup — keep location/payment
  const pickupIdx = sectionIndex(lines, isPickupHeading);
  if (pickupIdx >= 0) {
    const end = insertionEnd(lines, pickupIdx);
    const kept = lines.slice(pickupIdx + 1, end).filter(
      (line) => !/^\s*[-•·–—]\s*Availability:\s*/i.test(line)
    );
    lines.splice(pickupIdx + 1, end - pickupIdx - 1, ...kept);
  }

  return normalizeSpacing(lines.join("\n"));
}

export function applyUserProfileToDescription(description: string, profile?: UserProfile | null): string {
  if (!profile) return description;
  let text = description;
  if (profile.pickupLocation) {
    text = text.replace(/\[Insert City\/Neighborhood\]/gi, profile.pickupLocation);
  }
  if (profile.paymentMethods) {
    text = text.replace(/\[Insert Payment Methods\]/gi, profile.paymentMethods);
  }
  return text;
}
