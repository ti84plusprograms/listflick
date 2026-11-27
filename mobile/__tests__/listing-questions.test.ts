import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  QUESTIONS_CARD_TITLE,
  REPRICING_LABEL,
  UPDATING_LABEL,
  activePriceAfterAnswers,
  buildListingAnswers,
  draftAfterListingUpdate,
  listingChangesBetween,
  listingQuestionsFromListing,
  questionAnswer,
  setQuestionText,
  shouldRepriceAfterEdit,
  toggleQuestionOption,
  updateBusyLabel,
  workspaceToGeneratedListing,
} from "../utils/listingQuestions";
import { applyDraftListingEdits } from "../utils/listingWorkspace";
import type { ListingWorkspaceState, PriceSuggestion } from "../types/listing";

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

// 1. questions come from the backend listing, price question first
const questions = listingQuestionsFromListing({
  price_question: {
    question: "How much storage does it have?",
    why: "256GB sells for about $80 more.",
    options: ["128GB", "256GB"],
  },
  buyer_questions: [
    { question: "What is the battery health?", options: ["90%+", "80-89%"], affects_price: true },
    { question: "Is it unlocked?", options: [], affects_price: false },
    { question: "   ", options: [], affects_price: false },
  ],
});
equal(questions.length, 3, "blank questions are skipped");
equal(questions[0].id, "price", "price question first");
equal(questions[0].affectsPrice, true, "price question always affects price");
equal(questions[0].why, "256GB sells for about $80 more.", "keeps why line");
equal(questions[1].affectsPrice, true, "buyer question affects price flag");
equal(questions[2].affectsPrice, false, "buyer question without price impact");
equal(listingQuestionsFromListing(null).length, 0, "no listing, no questions");
equal(listingQuestionsFromListing({ price_question: null }).length, 0, "old listings have no questions");

// 2. chips select and deselect; typed text wins
let drafts = toggleQuestionOption({}, "price", "256GB");
equal(drafts.price.selected, "256GB", "tap selects a chip");
drafts = toggleQuestionOption(drafts, "price", "128GB");
equal(drafts.price.selected, "128GB", "tapping another chip switches");
drafts = toggleQuestionOption(drafts, "price", "128GB");
equal(drafts.price.selected, null, "tapping the selected chip deselects it");
drafts = toggleQuestionOption(drafts, "price", "256GB");
drafts = setQuestionText(drafts, "buyer-1", "  Yes, unlocked ");
equal(questionAnswer(drafts["buyer-1"]), "Yes, unlocked", "free text answer is trimmed");
equal(questionAnswer(setQuestionText(drafts, "price", "1TB").price), "1TB", "typed answer wins over a chip");

// 3. answers payload only includes answered questions and keeps the price flag
const answers = buildListingAnswers(questions, drafts);
deepEqual(
  answers,
  [
    { question: "How much storage does it have?", answer: "256GB", affects_price: true },
    { question: "Is it unlocked?", answer: "Yes, unlocked", affects_price: false },
  ],
  "builds answers"
);
equal(updateBusyLabel(answers), REPRICING_LABEL, "price answers show the re-checking label");
equal(updateBusyLabel([answers[1]]), UPDATING_LABEL, "other answers show the updating label");
equal(REPRICING_LABEL, "Re-checking the price…", "re-pricing copy");
equal(UPDATING_LABEL, "Updating your listing…", "updating copy");
equal(QUESTIONS_CARD_TITLE, "A few details to finish this listing", "card header copy");

// 4. active price after answers: manual is kept, tiers follow the backend, rounding to dollars
deepEqual(
  activePriceAfterAnswers({ active_price: 419.6, repriced: true }, { activePrice: 300, activePriceSource: "ai_fast_sale" }),
  { activePrice: 420, activePriceSource: "ai_fast_sale" },
  "picked tier follows the new price"
);
deepEqual(
  activePriceAfterAnswers({ active_price: 420, repriced: true }, { activePrice: 325, activePriceSource: "manual" }),
  { activePrice: 325, activePriceSource: "manual" },
  "manual price is never changed"
);
deepEqual(
  activePriceAfterAnswers({ active_price: 420, repriced: false }, { activePrice: 300 }),
  { activePrice: 300 },
  "no re-price keeps the current price"
);
deepEqual(
  activePriceAfterAnswers({ active_price: 420, repriced: true }, { activePrice: 300 }),
  { activePrice: 420, activePriceSource: "ai_recommended" },
  "unset source is treated as the recommended tier"
);

// 5. edit-form changes that affect price
const before = { condition: "Good", flaws: "", brandModel: "", accessories: "Case" };
equal(listingChangesBetween(before, { ...before }), null, "no changes");
equal(
  listingChangesBetween(before, { ...before, condition: "good" }),
  null,
  "condition normalization is not a change"
);
deepEqual(
  listingChangesBetween(before, { condition: "Fair", flaws: " cracked lens ", brandModel: "Apple iPhone 13", accessories: "" }),
  { condition: "Fair", flaws: "cracked lens", brand_model: "Apple iPhone 13", accessories: "" },
  "sends only changed fields, trimmed"
);
const someChange = { condition: "Fair" };
equal(shouldRepriceAfterEdit(someChange, "ai_recommended", { itemId: "i", insightsEnabled: true }), true, "re-prices AI prices");
equal(shouldRepriceAfterEdit(someChange, undefined, { itemId: "i", insightsEnabled: true }), true, "re-prices default price");
equal(shouldRepriceAfterEdit(someChange, "manual", { itemId: "i", insightsEnabled: true }), false, "never re-prices a manual price");
equal(shouldRepriceAfterEdit(null, "ai_recommended", { itemId: "i", insightsEnabled: true }), false, "no changes, no call");
equal(shouldRepriceAfterEdit(someChange, "ai_recommended", { insightsEnabled: true }), false, "needs a backend item");
equal(shouldRepriceAfterEdit(someChange, "ai_recommended", { itemId: "i", insightsEnabled: false }), false, "respects AI insights off");

// 6. request listing and draft persistence
const pricing: PriceSuggestion = {
  min: 300,
  max: 380,
  fast_sale_price: 300,
  recommended_price: 340,
  high_ask_price: 380,
  confidence: 0.7,
  pricing_reason: "Comparable sales",
};
const workspace: ListingWorkspaceState = {
  itemId: "item-1",
  imageUris: [],
  title: "Apple iPhone 13",
  description: "My words.",
  category: "Electronics",
  condition: "Good",
  activePrice: 325,
  activePriceSource: "manual",
  priceSuggestion: pricing,
  listingQuality: null,
  missingChecklist: [],
  imageQualityFeedback: [],
};
const requestListing = workspaceToGeneratedListing(workspace);
equal(requestListing.description, "My words.", "sends the seller's current text");
equal(requestListing.price_suggestion.recommended_price, 340, "keeps the suggestion");
equal(requestListing.marketplace_category, "Electronics", "sends category");

const newSuggestion = { ...pricing, recommended_price: 420 };
const draft = draftAfterListingUpdate(
  { brandModel: "Apple iPhone 13", activePriceSource: "manual" },
  { title: "T", description: "D", category: "C", activePrice: 325, priceSuggestion: newSuggestion }
);
equal(draft.brandModel, "Apple iPhone 13", "keeps other draft edits");
equal(draft.activePriceSource, "manual", "keeps the existing price source when none is given");
equal(applyDraftListingEdits(workspace, draft).priceSuggestion?.recommended_price, 420, "draft restores the new suggestion");

// 7. UI wiring (source checks, like the other screen tests)
const reviewSource = readFileSync(resolve(__dirname, "../app/review.tsx"), "utf8");
const cardSource = readFileSync(resolve(__dirname, "../components/listing/ListingQuestionsCard.tsx"), "utf8");
const editHookSource = readFileSync(resolve(__dirname, "../hooks/useEditListingForm.ts"), "utf8");
const apiSource = readFileSync(resolve(__dirname, "../services/api.ts"), "utf8");

equal(
  reviewSource.indexOf("<ListingQuestionsCard") > -1 &&
    reviewSource.indexOf("<ListingQuestionsCard") < reviewSource.indexOf("styles.titleText"),
  true,
  "questions card sits above the title"
);
equal(reviewSource.includes("listingQuestionsFromListing(item.listing)"), true, "questions load from the backend item");
equal(reviewSource.includes("dismiss: true"), true, "skip dismisses questions on the backend");
equal(reviewSource.includes("showAIKeyRequiredPrompt"), true, "review handles missing provider keys");
equal(reviewSource.includes("showAIProviderCredentialInvalidPrompt"), true, "review handles invalid provider keys");
equal(cardSource.includes('"Update Listing"'), true, "primary button copy");
equal(cardSource.includes("Skip for now"), true, "skip link copy");
equal(cardSource.includes("Affects price"), true, "affects price tag");
equal(cardSource.includes("accessibilityState={{ selected"), true, "chips expose selected state");
equal(cardSource.includes("accessibilityLabel={`Answer: ${question.question}`}"), true, "inputs are labelled");
equal(editHookSource.includes("listingChangesBetween(baselineRepriceFields.current"), true, "edit save compares to the starting values");
equal(editHookSource.includes("shouldRepriceAfterEdit("), true, "edit save skips manual prices");
equal(apiSource.includes("`/api/items/${itemId}/answers`"), true, "calls the answers endpoint");
equal(apiSource.includes("payload.dismiss ? undefined : await aiRequestHeaders()"), true, "dismiss needs no AI key");

console.log("Listing questions tests passed.");
