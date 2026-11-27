import type { ListingAnswer, ListingAnswersResponse, ListingChanges } from "../types/api";
import type {
  ActivePriceSource,
  DraftListingEdits,
  GeneratedListing,
  ListingWorkspaceState,
} from "../types/listing";
import { normalizeListingCondition } from "./descriptionFormatter";

export type ListingQuestionKind = "price" | "buyer";

/** One question shown on the listing preview, from the backend's price_question or buyer_questions. */
export interface ListingQuestion {
  id: string;
  kind: ListingQuestionKind;
  question: string;
  why: string;
  options: string[];
  affectsPrice: boolean;
}

export interface QuestionDraft {
  selected: string | null;
  text: string;
}

export type QuestionDrafts = Record<string, QuestionDraft>;

export const QUESTIONS_CARD_TITLE = "A few details to finish this listing";
export const REPRICING_LABEL = "Re-checking the price…";
export const UPDATING_LABEL = "Updating your listing…";

const EMPTY_DRAFT: QuestionDraft = { selected: null, text: "" };

export function listingQuestionsFromListing(
  listing?: Pick<GeneratedListing, "price_question" | "buyer_questions"> | null
): ListingQuestion[] {
  if (!listing) return [];
  const questions: ListingQuestion[] = [];
  const priceQuestion = listing.price_question;
  if (priceQuestion?.question?.trim()) {
    questions.push({
      id: "price",
      kind: "price",
      question: priceQuestion.question.trim(),
      why: priceQuestion.why?.trim() ?? "",
      options: priceQuestion.options ?? [],
      affectsPrice: true,
    });
  }
  (listing.buyer_questions ?? []).forEach((buyerQuestion, index) => {
    if (!buyerQuestion?.question?.trim()) return;
    questions.push({
      id: `buyer-${index}`,
      kind: "buyer",
      question: buyerQuestion.question.trim(),
      why: "",
      options: buyerQuestion.options ?? [],
      affectsPrice: Boolean(buyerQuestion.affects_price),
    });
  });
  return questions;
}

export function questionDraft(drafts: QuestionDrafts, id: string): QuestionDraft {
  return drafts[id] ?? EMPTY_DRAFT;
}

/** Tapping a chip selects it; tapping the selected chip again clears it. */
export function toggleQuestionOption(drafts: QuestionDrafts, id: string, option: string): QuestionDrafts {
  const current = questionDraft(drafts, id);
  return { ...drafts, [id]: { ...current, selected: current.selected === option ? null : option } };
}

export function setQuestionText(drafts: QuestionDrafts, id: string, text: string): QuestionDrafts {
  return { ...drafts, [id]: { ...questionDraft(drafts, id), text } };
}

/** A typed answer is more specific than a chip, so it wins when both are present. */
export function questionAnswer(draft: QuestionDraft | undefined): string {
  if (!draft) return "";
  return draft.text.trim() || draft.selected?.trim() || "";
}

export function buildListingAnswers(questions: ListingQuestion[], drafts: QuestionDrafts): ListingAnswer[] {
  return questions
    .map((question) => ({
      question: question.question,
      answer: questionAnswer(drafts[question.id]),
      affects_price: question.affectsPrice,
    }))
    .filter((answer) => answer.answer.length > 0);
}

export function answersAffectPrice(answers: ListingAnswer[]): boolean {
  return answers.some((answer) => answer.affects_price);
}

export function updateBusyLabel(answers: ListingAnswer[]): string {
  return answersAffectPrice(answers) ? REPRICING_LABEL : UPDATING_LABEL;
}

/**
 * The backend keeps a manual price and moves a picked tier to the new suggestion; the app
 * applies that result as a whole-dollar price like the rest of the pricing UI.
 */
export function activePriceAfterAnswers(
  response: Pick<ListingAnswersResponse, "active_price" | "repriced">,
  current: { activePrice: number; activePriceSource?: ActivePriceSource }
): { activePrice: number; activePriceSource?: ActivePriceSource } {
  if (current.activePriceSource === "manual" || !response.repriced) return current;
  const next = Math.round(response.active_price || 0);
  if (next <= 0) return current;
  return { activePrice: next, activePriceSource: current.activePriceSource ?? "ai_recommended" };
}

export type RepriceFields = {
  condition: string;
  flaws: string;
  brandModel: string;
  accessories: string;
};

/** Edit-form fields that change what the item is worth; only the ones the seller changed are sent. */
export function listingChangesBetween(before: RepriceFields, after: RepriceFields): ListingChanges | null {
  const changes: ListingChanges = {};
  const beforeCondition = normalizeListingCondition(before.condition, before.flaws) || before.condition.trim();
  const afterCondition = normalizeListingCondition(after.condition, after.flaws) || after.condition.trim();
  if (beforeCondition !== afterCondition) changes.condition = afterCondition;
  if (before.flaws.trim() !== after.flaws.trim()) changes.flaws = after.flaws.trim();
  if (before.brandModel.trim() !== after.brandModel.trim()) changes.brand_model = after.brandModel.trim();
  if (before.accessories.trim() !== after.accessories.trim()) changes.accessories = after.accessories.trim();
  return Object.keys(changes).length > 0 ? changes : null;
}

export function shouldRepriceAfterEdit(
  changes: ListingChanges | null,
  activePriceSource: ActivePriceSource | undefined,
  options: { itemId?: string; insightsEnabled: boolean }
): boolean {
  return Boolean(changes && options.itemId && options.insightsEnabled && activePriceSource !== "manual");
}

/** The listing text the seller is looking at, so the backend revises their current wording. */
export function workspaceToGeneratedListing(
  listing: Pick<
    ListingWorkspaceState,
    "title" | "description" | "category" | "activePrice" | "priceSuggestion" | "listingQuality"
  >
): GeneratedListing {
  const price = listing.activePrice || listing.priceSuggestion?.recommended_price || 0;
  const suggestion = listing.priceSuggestion;
  return {
    title: listing.title,
    description: listing.description,
    marketplace_category: listing.category,
    tags: [],
    price_suggestion: {
      min: suggestion?.min || suggestion?.fast_sale_price || price,
      max: suggestion?.max || suggestion?.high_ask_price || price,
      fast_sale_price: suggestion?.fast_sale_price || suggestion?.min || price,
      recommended_price: suggestion?.recommended_price || price,
      high_ask_price: suggestion?.high_ask_price || suggestion?.max || price,
      confidence: suggestion?.confidence ?? 0,
      pricing_reason: suggestion?.pricing_reason ?? "",
      pricing_warnings: suggestion?.pricing_warnings ?? [],
    },
    listing_quality: listing.listingQuality ?? {
      overall_score: 0,
      readiness_label: "needs_work",
      score_breakdown: {},
      improvement_suggestions: [],
    },
  };
}

/** Keep the seller's other draft edits and record what the answers changed, so it survives a refocus. */
export function draftAfterListingUpdate(
  existing: DraftListingEdits | null,
  update: {
    title: string;
    description: string;
    category: string;
    activePrice: number;
    activePriceSource?: ActivePriceSource;
    priceSuggestion: GeneratedListing["price_suggestion"];
  }
): DraftListingEdits {
  return {
    ...(existing ?? {}),
    title: update.title,
    description: update.description,
    category: update.category,
    activePrice: update.activePrice,
    activePriceSource: update.activePriceSource ?? existing?.activePriceSource,
    priceSuggestion: update.priceSuggestion,
  };
}
