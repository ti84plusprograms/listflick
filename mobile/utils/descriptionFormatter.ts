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

// Labels that only the old appended "Details:" block used (the plain layout never writes them).
const LEGACY_ONLY_DETAIL_LABELS = [
  "Listing title",
  "Category",
  "Asking price",
  "Condition",
  "Flaws/damage",
  "Pickup/shipping/payment",
];

// Legacy layout: emoji section headers with a price line.
const SECTION = {
  features: "🔹 Features:",
  price: "💵 Price:",
  condition: "✅ Condition:",
  pickup: "📍 Pickup Details:",
} as const;

// Plain layout (current): opening, "Details:" list, "Condition: ...", one logistics line, no price.
const PLAIN_SECTION = {
  details: "Details:",
  condition: "Condition:",
} as const;

const OFFERS_SENTENCE = "Open to reasonable offers.";
const OFFERS_PATTERN = /\bopen to (?:reasonable )?offers\b|\bobo\b|\bnegotiable\b|\bbest offer\b/i;
const FIRM_PATTERN = /\bfirm\b/i;
const PICKUP_PATTERN = /\bpick\s?up\b|\bmeet\s?up\b/i;
const SHIPPING_PATTERN = /\bship(?:s|ping)?\b/i;
const NO_SHIPPING_PATTERN = /\bno shipping\b|\bdoes(?:n't| not) ship\b|\bwon't ship\b|\bwill not ship\b/i;
const LOGISTICS_PATTERN =
  /\b(?:pick\s?up|meet\s?up|ship(?:s|ping)?|delivery|cash|venmo|zelle|paypal|cash app|payment|offers?|firm|obo|negotiable)\b/i;
const MANAGED_AVAILABILITY_PATTERN = /^(?:local pickup(?: or shipping available)?|shipping available)\.?$/i;

export type DescriptionLayout = "legacy" | "plain";

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
  negotiable?: boolean;
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

function hasLegacyOnlyDetailLabel(block: string): boolean {
  return block
    .split("\n")
    .map((line) => line.trim())
    .some((line) => LEGACY_ONLY_DETAIL_LABELS.some((label) => line.startsWith(`- ${label}:`)));
}

function stripLegacyDetailsBlock(description: string): string {
  let stripped = description.trimEnd();

  while (true) {
    const idx = stripped.lastIndexOf(LEGACY_DETAILS_MARKER);
    if (idx === -1) return stripped.trim();

    const block = stripped.substring(idx + LEGACY_DETAILS_MARKER.length);
    if (!isLegacyManagedDetailsBlock(block)) return stripped.trim();
    // The plain layout has its own "Details:" list; only strip blocks the old app appended.
    const before = stripped.substring(0, idx);
    if (descriptionLayout(before) === "plain" && !hasLegacyOnlyDetailLabel(block)) return stripped.trim();

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

function isDetailsHeading(line: string): boolean {
  return /^Details:\s*$/i.test(line);
}

function isPlainConditionLine(line: string): boolean {
  return /^Condition:\s*/i.test(line);
}

function isPlainSectionLine(line: string): boolean {
  return isDetailsHeading(line) || isPlainConditionLine(line);
}

function isBulletLine(line: string): boolean {
  return /^[•·*\-–—]\s*/.test(line);
}

/** Legacy descriptions carry emoji section headers; everything else is edited as the plain layout. */
export function descriptionLayout(description: string): DescriptionLayout {
  return description.split("\n").some((line) => isKnownSectionLine(line.trim())) ? "legacy" : "plain";
}

function conditionLineMatcher(layout: DescriptionLayout): (line: string) => boolean {
  return layout === "legacy" ? isConditionLine : isPlainConditionLine;
}

/** End (exclusive) of a plain-layout block: the next blank line or section line. */
function plainBlockEnd(lines: string[], start: number): number {
  let end = start + 1;
  while (end < lines.length && lines[end].trim() !== "" && !isPlainSectionLine(lines[end].trim())) {
    end += 1;
  }
  return end;
}

function splitSentences(value: string): string[] {
  return (value.match(/[^.!?]+[.!?]*/g) ?? []).map((part) => part.trim()).filter(Boolean);
}

function asSentence(value: string): string {
  const text = value.trim();
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function capitalizeFirst(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** The plain layout's logistics line: after the condition line, not a list item, mentions pickup/shipping/payment/offers. */
function plainLogisticsIndex(lines: string[]): number {
  const conditionIndex = sectionIndex(lines, isPlainConditionLine);
  for (let i = lines.length - 1; i > conditionIndex; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (isPlainSectionLine(line) || isBulletLine(line)) return -1;
    if (conditionIndex === -1) {
      // Without a condition line, never treat the opening paragraph as the logistics line.
      const firstBlank = lines.findIndex((candidate) => candidate.trim() === "");
      if (firstBlank === -1 || i < firstBlank) return -1;
    }
    return LOGISTICS_PATTERN.test(line) ? i : -1;
  }
  return -1;
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
      new RegExp(`^[•·*\\-–—]\\s*${escapeRegex(label)}:`, "i").test(trimmed)
    );
  });
}

function detectBulletPrefix(lines: string[]): string {
  for (const line of lines) {
    const match = line.match(/^(\s*[•·*\-–—]\s+)/);
    if (match) return match[1];
  }
  return "- ";
}

function upsertPlainDetailsSection(lines: string[], details: DescriptionDetails): string[] {
  const detailsIndex = sectionIndex(lines, isDetailsHeading);
  const existingBlock = detailsIndex >= 0 ? lines.slice(detailsIndex + 1, plainBlockEnd(lines, detailsIndex)) : [];
  const bullet = detectBulletPrefix(existingBlock);
  const managedLines = [
    details.brandModel.trim() ? `${bullet}${FEATURE_LABELS[0]}: ${details.brandModel.trim()}` : "",
    details.color.trim() ? `${bullet}${FEATURE_LABELS[1]}: ${details.color.trim()}` : "",
    details.material.trim() ? `${bullet}${FEATURE_LABELS[2]}: ${details.material.trim()}` : "",
    details.dimensions.trim() ? `${bullet}${FEATURE_LABELS[3]}: ${details.dimensions.trim()}` : "",
    details.accessories.trim() ? `${bullet}${FEATURE_LABELS[4]}: ${details.accessories.trim()}` : "",
  ].filter(Boolean);

  if (detailsIndex === -1) {
    if (managedLines.length === 0) return lines;
    const conditionIndex = sectionIndex(lines, isPlainConditionLine);
    const firstBlank = lines.findIndex((line) => line.trim() === "");
    const insertAt = conditionIndex >= 0 ? conditionIndex : firstBlank >= 0 ? firstBlank : lines.length;
    const next = [...lines];
    next.splice(insertAt, 0, "", PLAIN_SECTION.details, ...managedLines, "");
    return next;
  }

  const end = plainBlockEnd(lines, detailsIndex);
  const kept = removeManagedFeatureLines(existingBlock).filter((line) => line.trim() !== "");
  const items = [...kept, ...managedLines];
  if (items.length === 0) {
    return [...lines.slice(0, detailsIndex), ...lines.slice(end)];
  }
  return [...lines.slice(0, detailsIndex + 1), ...items, "", ...lines.slice(end)];
}

function upsertFeaturesSection(lines: string[], details: DescriptionDetails, layout: DescriptionLayout = "legacy"): string[] {
  if (layout === "plain") return upsertPlainDetailsSection(lines, details);
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

function upsertPriceSection(lines: string[], askingPrice: string, layout: DescriptionLayout = "legacy"): string[] {
  // The plain layout never carries a price: Marketplace shows it separately.
  if (layout === "plain") return lines;
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

function isPlaceholder(value: string): boolean {
  return /^\[[^\]]*\]\.?$/.test(value.trim());
}

function upsertPlainConditionSection(lines: string[], normalizedCondition: string, flaws: string): string[] {
  const conditionIndex = sectionIndex(lines, isPlainConditionLine);
  const existing = conditionIndex >= 0 ? lines[conditionIndex].trim().replace(/^Condition:\s*/i, "") : "";
  const existingRemainder = conditionRemainder(existing);
  const detailText =
    flaws.trim() || (isBenignConditionDetail(existingRemainder) ? existingRemainder : "");
  const parts = [
    normalizedCondition ? asSentence(normalizedCondition) : "",
    detailText ? asSentence(capitalizeFirst(detailText)) : "",
  ].filter(Boolean);
  const conditionLine = `${PLAIN_SECTION.condition} ${parts.join(" ")}`;

  if (conditionIndex >= 0) {
    const next = [...lines];
    next[conditionIndex] = conditionLine;
    return next;
  }
  const logisticsIndex = plainLogisticsIndex(lines);
  const insertAt = logisticsIndex >= 0 ? logisticsIndex : lines.length;
  const next = [...lines];
  next.splice(insertAt, 0, "", conditionLine, "");
  return next;
}

function upsertConditionSection(
  lines: string[],
  condition: string,
  flaws: string,
  layout: DescriptionLayout = "legacy"
): string[] {
  const normalizedCondition = normalizeListingCondition(condition, flaws) || condition.trim();
  if (!normalizedCondition && !flaws.trim()) return lines;
  if (layout === "plain") return upsertPlainConditionSection(lines, normalizedCondition, flaws);

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

function availabilitySentence(wantsPickup: boolean, wantsShipping: boolean): string {
  if (wantsPickup && wantsShipping) return "Local pickup or shipping available.";
  if (wantsPickup) return "Local pickup.";
  if (wantsShipping) return "Shipping available.";
  return "";
}

type LogisticsClause = { text: string; priceTerm: boolean };

function finishClause(text: string): string {
  const trimmed = text.trim().replace(/[,;]+$/, "");
  if (!trimmed) return "";
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

// Seller-written lines often pack pickup, payment and price terms into one sentence
// ("Pickup in Midtown, cash or Venmo, open to offers."). Work clause by clause so toggling one
// setting only touches the clause it owns, and keep untouched sentences exactly as written.
function splitLogisticsSentence(
  sentence: string,
  wantsPickup: boolean,
  wantsShipping: boolean,
  negotiable: boolean
): { kept: string; priceTerms: string[]; keptOffer: boolean; pricingOnly: boolean } {
  const body = sentence.replace(/[.!?]+$/, "");
  const clauses: LogisticsClause[] = body
    .split(/[,;]\s+/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text, priceTerm: OFFERS_PATTERN.test(text) || FIRM_PATTERN.test(text) }));
  const dropForSettings = (text: string) =>
    MANAGED_AVAILABILITY_PATTERN.test(text) ||
    (!wantsPickup && PICKUP_PATTERN.test(text)) ||
    (!wantsShipping && SHIPPING_PATTERN.test(text) && !NO_SHIPPING_PATTERN.test(text));
  const priceTermStays = (text: string) => (negotiable ? OFFERS_PATTERN.test(text) : !OFFERS_PATTERN.test(text));
  const unchanged = clauses.every((clause) =>
    clause.priceTerm ? priceTermStays(clause.text) : !dropForSettings(clause.text)
  );
  if (unchanged) {
    return {
      kept: sentence,
      priceTerms: [],
      keptOffer: OFFERS_PATTERN.test(sentence),
      pricingOnly: clauses.length > 0 && clauses.every((clause) => clause.priceTerm),
    };
  }
  const keptClauses = clauses.filter((clause) => !clause.priceTerm && !dropForSettings(clause.text));
  const priceTerms = clauses.filter((clause) => clause.priceTerm).map((clause) => clause.text);
  const isWholePriceSentence = priceTerms.length === clauses.length;
  return {
    kept: finishClause(keptClauses.map((clause) => clause.text).join(", ")),
    priceTerms: isWholePriceSentence ? [sentence] : priceTerms.map(finishClause),
    keptOffer: false,
    pricingOnly: false,
  };
}

function upsertPlainLogistics(lines: string[], preferences: string, negotiable: boolean): string[] {
  const logisticsIndex = plainLogisticsIndex(lines);
  const sentences = logisticsIndex >= 0 ? splitSentences(lines[logisticsIndex].trim()) : [];
  const wantsPickup = /\bpick\s?up\b/i.test(preferences);
  const wantsShipping = /\bship/i.test(preferences);

  const base: string[] = [];
  const priceTerms: string[] = [];
  let offerAlreadyKept = false;
  // Price terms read best last, so a regenerated availability sentence goes in front of them.
  let firstPricingIndex = -1;
  for (const sentence of sentences) {
    const split = splitLogisticsSentence(sentence, wantsPickup, wantsShipping, negotiable);
    if (split.pricingOnly && firstPricingIndex < 0) firstPricingIndex = base.length;
    if (split.kept) base.push(split.kept);
    priceTerms.push(...split.priceTerms);
    offerAlreadyKept ||= split.keptOffer;
  }

  const otherText = [...lines.filter((_, index) => index !== logisticsIndex), ...base].join(" ");
  const availability = availabilitySentence(
    wantsPickup && !PICKUP_PATTERN.test(otherText),
    wantsShipping && !(SHIPPING_PATTERN.test(otherText) && !NO_SHIPPING_PATTERN.test(otherText))
  );

  const keptPriceTerms = negotiable
    ? priceTerms.filter((sentence) => OFFERS_PATTERN.test(sentence))
    : priceTerms.filter((sentence) => !OFFERS_PATTERN.test(sentence));
  if (negotiable && keptPriceTerms.length === 0 && !offerAlreadyKept) keptPriceTerms.push(OFFERS_SENTENCE);

  const ordered =
    firstPricingIndex >= 0
      ? [...base.slice(0, firstPricingIndex), availability, ...base.slice(firstPricingIndex)]
      : [...base, availability];
  const nextLine = [...ordered, ...keptPriceTerms].filter(Boolean).join(" ");
  const next = [...lines];
  if (logisticsIndex >= 0) {
    if (nextLine) next[logisticsIndex] = nextLine;
    else next.splice(logisticsIndex, 1);
    return next;
  }
  if (!nextLine) return lines;
  return [...next, "", nextLine];
}

function upsertPickupSection(
  lines: string[],
  preferences: string,
  layout: DescriptionLayout = "legacy",
  negotiable = false
): string[] {
  if (layout === "plain") return upsertPlainLogistics(lines, preferences, negotiable);
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
  // Accept the same bullets removeManagedFeatureLines strips (plus "*"), so an edit never
  // deletes a "• Color: White" line it failed to read.
  const pattern = new RegExp(`^[•·*\\-–—]\\s*${escapeRegex(label)}:\\s*`, "i");
  const match = lines.map((line) => line.trim()).find((line) => pattern.test(line));
  return match ? match.replace(pattern, "").trim() : "";
}

function extractAvailability(lines: string[]): string {
  const match = lines
    .map((line) => line.trim())
    .find((line) => /^\s*[-•]\s*Availability:\s*/i.test(line));
  return match ? match.replace(/^\s*[-•]\s*Availability:\s*/i, "").trim() : "";
}

function extractConditionDetail(conditionLine: string): string {
  const match = conditionLine.match(/^(?:✅\s*)?Condition:\s*(.*)$/i);
  if (!match) return "";
  const detail = conditionRemainder(match[1]);
  return isBenignConditionDetail(detail) || isPlaceholder(detail) ? "" : detail;
}

function parsePlainListingDescription(clean: string, lines: string[]): ParsedListingDescription {
  const conditionLine = lines.find(isPlainConditionLine) ?? "";
  const logisticsIndex = plainLogisticsIndex(lines);
  const logistics = logisticsIndex >= 0 ? lines[logisticsIndex] : "";
  const lower = clean.toLowerCase();
  const localPickup =
    PICKUP_PATTERN.test(logistics) ||
    /\b(local pickup|porch pickup|pickup only|pick up available|meetup|meet up)\b/i.test(lower);
  const shipping = SHIPPING_PATTERN.test(logistics) && !NO_SHIPPING_PATTERN.test(logistics);
  const preferences = [localPickup ? "Local pickup" : "", shipping ? "Shipping available" : ""]
    .filter(Boolean)
    .join(", ");

  return {
    askingPrice: "",
    negotiable: OFFERS_PATTERN.test(logistics),
    condition: extractCondition(conditionLine),
    brandModel: extractManagedFeature(lines, "Brand/model"),
    color: extractManagedFeature(lines, "Color"),
    material: extractManagedFeature(lines, "Material"),
    dimensions: extractManagedFeature(lines, "Dimensions"),
    flaws: extractConditionDetail(conditionLine),
    accessories: extractManagedFeature(lines, "Included accessories"),
    preferences,
    localPickup,
    shipping,
  };
}

export function parseListingDescription(description: string): ParsedListingDescription {
  const clean = stripLegacyDetailsBlock(description);
  const lines = clean.split("\n").map((line) => line.trim());
  if (descriptionLayout(clean) === "plain") return parsePlainListingDescription(clean, lines);
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
  const layout = descriptionLayout(clean);
  const negotiable = details.negotiable ?? /\bnegotiable\b/i.test(details.askingPrice ?? "");

  lines = upsertFeaturesSection(lines, details, layout);
  lines = upsertPriceSection(lines, details.askingPrice ?? "", layout);
  lines = upsertConditionSection(lines, details.condition ?? "", details.flaws, layout);
  lines = upsertPickupSection(lines, details.preferences, layout, negotiable);

  return normalizeSpacing(lines.join("\n"));
}

export function stripAppendedDetailsBlock(description: string): string {
  let clean = stripLegacyDetailsBlock(description);
  let lines = clean.split("\n");

  if (descriptionLayout(clean) === "plain") {
    // Remove only managed lines (Brand/model, Color, ...) and the managed availability sentence.
    const detailsIdx = sectionIndex(lines, isDetailsHeading);
    if (detailsIdx >= 0) {
      const end = plainBlockEnd(lines, detailsIdx);
      const kept = removeManagedFeatureLines(lines.slice(detailsIdx + 1, end));
      if (kept.some((line) => line.trim())) lines.splice(detailsIdx + 1, end - detailsIdx - 1, ...kept);
      else lines.splice(detailsIdx, end - detailsIdx);
    }
    const logisticsIdx = plainLogisticsIndex(lines);
    if (logisticsIdx >= 0) {
      const kept = splitSentences(lines[logisticsIdx]).filter((sentence) => !MANAGED_AVAILABILITY_PATTERN.test(sentence));
      if (kept.length) lines[logisticsIdx] = kept.join(" ");
      else lines.splice(logisticsIdx, 1);
    }
    return normalizeSpacing(lines.join("\n"));
  }

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
  if (descriptionLayout(text) === "legacy") return text;

  // Plain layout leaves logistics out when the AI does not know them; fill them from the profile.
  const location = profile.pickupLocation?.trim() ?? "";
  const payment = profile.paymentMethods?.trim() ?? "";
  const lines = text.split("\n");
  if (plainLogisticsIndex(lines) >= 0 || (!location && !payment)) return text;
  const logistics = [
    location ? `Pickup in ${location.replace(/[.\s]+$/, "")}.` : "",
    payment ? asSentence(capitalizeFirst(payment)) : "",
  ]
    .filter(Boolean)
    .join(" ");
  return normalizeSpacing(`${text}\n\n${logistics}`);
}
