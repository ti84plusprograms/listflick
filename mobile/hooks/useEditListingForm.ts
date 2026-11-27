import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler } from "react-native";

import { ApiError, answerListingQuestions, improveListing } from "../services/api";
import {
  getDraftListingEdits,
  getListingDefaults,
  getUserProfile,
  saveDraftDescription,
  saveDraftListingEdits,
} from "../services/storage";
import {
  REPRICING_LABEL,
  activePriceAfterAnswers,
  listingChangesBetween,
  shouldRepriceAfterEdit,
  type RepriceFields,
} from "../utils/listingQuestions";
import { useAIInsightsEnabled } from "../state/AIInsightsContext";
import { useAuth } from "../state/AuthContext";
import {
  useListingIdentity,
  useListingInsights,
  useListingPricing,
  useListingWorkspaceActions,
} from "../state/ListingWorkspaceContext";
import type {
  ActivePriceSource,
  ImprovementAction,
  ListingEditFocus,
} from "../types/listing";
import {
  applyDraftListingEdits,
  parseListingWorkspaceParams,
  type ListingWorkspaceParams,
} from "../utils/listingWorkspace";
import { applyUserProfileToDescription, parseListingDescription } from "../utils/descriptionFormatter";
import { userProfileDefaultsFromAuth } from "../utils/userProfile";
import {
  showAIKeyRequiredPrompt,
  showAIProviderCredentialInvalidPrompt,
  showAIProviderRequiredPrompt,
} from "../utils/aiCredentialPrompt";
import { providerDisplayName } from "../utils/aiSettingsState";
import {
  applyListingImprovementToForm,
  buildAIImprovementListing,
  createInitialEditListingForm,
  defaultListingQuality,
  descriptionDetailsFromForm,
  descriptionWithFormDetails,
  formToDraftListingEdits,
  formToWorkspaceDetails,
  formToWorkspacePricing,
  listingImprovementHints,
  listingImprovementSummary,
  type EditListingFormState,
  improvementSummary as chipImprovementSummary,
} from "../utils/editListingForm";

type EditListingField = keyof EditListingFormState;

function repriceFieldsFromForm(form: EditListingFormState): RepriceFields {
  return {
    condition: form.condition,
    flaws: form.flaws,
    brandModel: form.brandModel,
    accessories: form.accessories,
  };
}

function sameDescriptionDetails(
  left: ReturnType<typeof descriptionDetailsFromForm>,
  right: ReturnType<typeof descriptionDetailsFromForm>
): boolean {
  return Object.keys(left).every((key) => {
    const detailKey = key as keyof typeof left;
    return left[detailKey] === right[detailKey];
  });
}

export function useEditListingForm() {
  const params = useLocalSearchParams<ListingWorkspaceParams & { focus?: ListingEditFocus }>();
  const paramsString = JSON.stringify(params);
  const listing = useMemo(() => parseListingWorkspaceParams(JSON.parse(paramsString)), [paramsString]);
  const parsedDescription = useMemo(() => parseListingDescription(listing.description), [listing.description]);
  const insightsEnabled = useAIInsightsEnabled();
  const { user } = useAuth();
  const authProfileDefaults = useMemo(
    () => userProfileDefaultsFromAuth(user),
    [user?.displayName, user?.email]
  );
  const { activePriceSource, priceSuggestion: pricing } = useListingPricing();
  const { listingQuality, missingChecklist } = useListingInsights();
  const { hydrateWorkspace, updateDetails, updatePricing, updateInsights } = useListingWorkspaceActions();
  const draftId = listing.itemId ?? listing.savedId ?? "current";

  const [form, setForm] = useState(() =>
    createInitialEditListingForm({ listing, parsedDescription })
  );
  const [improving, setImproving] = useState(false);
  const [improvementSummary, setImprovementSummary] = useState("");
  const improvementHints = listingImprovementHints(missingChecklist, insightsEnabled);
  const [improvingAction, setImprovingAction] = useState<ImprovementAction | null>(null);
  // One plain line under the description saying what the last AI improvement changed.
  const [improveSummary, setImproveSummary] = useState<string | null>(null);
  const [repricing, setRepricing] = useState(false);
  const savingRef = useRef(false);
  // Save can wait on a slow price check; these keep a late result from popping an extra screen
  // or writing into whichever listing the workspace holds by then.
  const mountedRef = useRef(true);
  const previousDetails = useRef(descriptionDetailsFromForm(form));
  // What the seller started from, so Save can tell which price-relevant fields changed.
  const baselineRepriceFields = useRef(repriceFieldsFromForm(form));

  const setField = useCallback(<T extends EditListingField>(field: T, value: EditListingFormState[T]) => {
    setImprovementSummary("");
    setForm((current) => ({ ...current, [field]: value }));
  }, []);

  const identityRef = useRef(useListingIdentity());
  identityRef.current = useListingIdentity();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!repricing) return;
    // Hold Android back while the price check runs, the same as the disabled Preview button.
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [repricing]);

  useEffect(() => {
    let active = true;
    const alreadyHydrated =
      identityRef.current.itemId === listing.itemId && identityRef.current.itemId != null;

    if (!alreadyHydrated) {
      hydrateWorkspace(listing);
    }
    
    // For the form, we should ideally use the context state if alreadyHydrated is true,
    // but the `listing` param state is mostly fine since edit-listing doesn't use the large fields like imageQualityFeedback.
    const initialForm = createInitialEditListingForm({ listing, parsedDescription });
    baselineRepriceFields.current = repriceFieldsFromForm(initialForm);
    setForm(initialForm);

    Promise.all([getDraftListingEdits(draftId), getListingDefaults()]).then(([draft, defaults]) => {
      if (!active) return;
      hydrateWorkspace(applyDraftListingEdits(listing, draft));
      const hydratedForm = createInitialEditListingForm({ listing, parsedDescription, draft, defaults });
      baselineRepriceFields.current = repriceFieldsFromForm(hydratedForm);
      setForm(hydratedForm);
    });

    return () => {
      active = false;
    };
  }, [draftId, hydrateWorkspace, listing, parsedDescription]);

  useEffect(() => {
    const currentDetails = descriptionDetailsFromForm(form);
    if (sameDescriptionDetails(currentDetails, previousDetails.current)) return;

    previousDetails.current = currentDetails;
    setForm((current) => ({
      ...current,
      description: descriptionWithFormDetails(current.description, current),
    }));
  }, [form]);

  const setPriceInput = useCallback(
    (value: string) => {
      setField("priceInput", value);
      updatePricing({
        activePrice: Number(value) || 0,
        activePriceSource: "manual",
      });
    },
    [setField, updatePricing]
  );

  const applyPriceTier = useCallback(
    (value: number | null | undefined, source: ActivePriceSource) => {
      if (!value || !Number.isFinite(value) || value <= 0) return;
      const rounded = Math.round(value);
      setField("priceInput", String(rounded));
      updatePricing({ activePrice: rounded, activePriceSource: source });
    },
    [setField, updatePricing]
  );

  const runImprovement = useCallback(
    /**
     * `from` says where the seller asked: a suggestion card next to a field reports the
     * fields it changed right there; the Improve with AI chips report under the chips.
     */
    async (action: ImprovementAction, customInstruction = "", from: "chips" | "suggestion" = "chips") => {
      if (!insightsEnabled || improving) return;
      setImproving(true);
      setImprovingAction(action);
      setImproveSummary(null);
      setImprovementSummary("");
      const before = { title: form.title, description: form.description, price: form.priceInput };
      try {
        const result = await improveListing({
          item_id: listing.itemId,
          listing: buildAIImprovementListing(form, pricing, listingQuality),
          action,
          custom_instruction: customInstruction,
        });
        const profile = await getUserProfile(user?.uid, authProfileDefaults);
        const finalDescription = applyUserProfileToDescription(result.listing.description, profile);
        const appliedImprovement = applyListingImprovementToForm(
          form,
          result.listing,
          finalDescription
        );

        setForm(appliedImprovement.form);
        if (from === "suggestion") {
          setImprovementSummary(listingImprovementSummary(appliedImprovement.changedFields));
        }
        updateDetails({
          title: appliedImprovement.form.title,
          description: appliedImprovement.form.description,
          category: appliedImprovement.form.category,
        });
        updateInsights({
          listingQuality: result.listing.listing_quality ?? defaultListingQuality(),
          missingChecklist: result.missing_checklist ?? missingChecklist,
        });

        const nextPrice =
          result.listing.price_suggestion.recommended_price ||
          result.listing.price_suggestion.max ||
          result.listing.price_suggestion.min ||
          0;
        let nextPriceText: string | null = null;
        if (nextPrice > 0 && action === "make_price_more_competitive") {
          const rounded = Math.round(nextPrice);
          nextPriceText = String(rounded);
          setField("priceInput", nextPriceText);
          // Move the tiers too, so Fast / Recommended / High Ask match the new price.
          updatePricing({
            activePrice: rounded,
            activePriceSource: "ai_recommended",
            priceSuggestion: result.listing.price_suggestion,
          });
        }
        if (from === "chips") setImproveSummary(
          chipImprovementSummary(action, before, {
            title: result.listing.title,
            description: finalDescription,
            price: nextPriceText ?? before.price,
          })
        );
      } catch (e) {
        if (e instanceof ApiError && e.code === "AI_PROVIDER_SELECTION_REQUIRED") {
          showAIProviderRequiredPrompt();
          return;
        }
        if (e instanceof ApiError && e.code === "AI_CREDENTIAL_REQUIRED" && e.provider) {
          showAIKeyRequiredPrompt(e.provider, `Add your ${providerDisplayName(e.provider)} API key to improve this listing.`);
          return;
        }
        if (e instanceof ApiError && e.code === "AI_PROVIDER_CREDENTIAL_INVALID" && e.provider) {
          showAIProviderCredentialInvalidPrompt(e.provider);
          return;
        }
        const message = e instanceof ApiError || e instanceof Error ? e.message : "Could not improve listing";
        Alert.alert("Improve Listing", message);
      } finally {
        setImproving(false);
        setImprovingAction(null);
      }
    },
    [
      authProfileDefaults,
      form,
      improving,
      insightsEnabled,
      listing.itemId,
      listingQuality,
      missingChecklist,
      pricing,
      setField,
      updateDetails,
      updateInsights,
      updatePricing,
      user?.uid,
    ]
  );

  /**
   * When condition, flaws, brand/model or included accessories changed and the price was not set by
   * hand, ask the backend to re-price and fold the new facts into the description before saving.
   */
  const repriceForChanges = useCallback(
    async (current: EditListingFormState) => {
      const changes = listingChangesBetween(baselineRepriceFields.current, repriceFieldsFromForm(current));
      if (!shouldRepriceAfterEdit(changes, activePriceSource, { itemId: listing.itemId, insightsEnabled })) {
        return null;
      }
      const activePrice = Number(current.priceInput) || 0;
      setRepricing(true);
      const result = await answerListingQuestions(listing.itemId!, {
        changes,
        listing: buildAIImprovementListing(current, pricing, listingQuality),
        active_price: activePrice,
        active_price_source: activePriceSource ?? null,
      });
      const profile = await getUserProfile(user?.uid, authProfileDefaults);
      const nextPrice = activePriceAfterAnswers(result, { activePrice, activePriceSource });
      updateInsights({
        listingQuality: result.listing.listing_quality ?? defaultListingQuality(),
        missingChecklist: result.missing_checklist ?? missingChecklist,
      });
      return {
        form: {
          ...current,
          title: result.listing.title || current.title,
          description: applyUserProfileToDescription(result.listing.description, profile),
          category: result.listing.marketplace_category || current.category,
          priceInput: nextPrice.activePrice > 0 ? String(nextPrice.activePrice) : current.priceInput,
        },
        activePriceSource: nextPrice.activePriceSource,
        priceSuggestion: result.listing.price_suggestion,
      };
    },
    [
      activePriceSource,
      authProfileDefaults,
      insightsEnabled,
      listing.itemId,
      listingQuality,
      missingChecklist,
      pricing,
      updateInsights,
      user?.uid,
    ]
  );

  const saveEdits = useCallback(async () => {
    if (repricing || savingRef.current) return;
    savingRef.current = true;
    const startItemId = listing.itemId;
    let nextForm = form;
    let nextPriceSource = activePriceSource;
    let nextSuggestion = pricing ?? undefined;
    let repriceError: unknown = null;

    try {
      const repriced = await repriceForChanges(form);
      if (repriced) {
        nextForm = repriced.form;
        nextPriceSource = repriced.activePriceSource;
        nextSuggestion = repriced.priceSuggestion;
      }
    } catch (e) {
      // Never lose the seller's edits because the price check failed; save them and explain after.
      repriceError = e;
    } finally {
      setRepricing(false);
    }

    try {
      await saveDraftListingEdits(draftId, {
        ...formToDraftListingEdits(nextForm, nextPriceSource),
        priceSuggestion: nextSuggestion,
      });
      await saveDraftDescription(draftId, nextForm.description);
    } catch {
      savingRef.current = false;
      if (mountedRef.current) {
        Alert.alert("Couldn't save", "Your edits could not be saved. Try again.");
      }
      return;
    }
    savingRef.current = false;
    // The draft is saved by id either way. Only touch the shared workspace and navigation if the
    // seller is still on this listing's edit screen.
    if (!mountedRef.current || identityRef.current.itemId !== startItemId) return;
    updateDetails(formToWorkspaceDetails(nextForm));
    updatePricing({
      ...formToWorkspacePricing(nextForm, nextPriceSource),
      ...(nextSuggestion ? { priceSuggestion: nextSuggestion } : {}),
    });
    router.back();

    if (!repriceError) return;
    if (repriceError instanceof ApiError && repriceError.code === "AI_PROVIDER_SELECTION_REQUIRED") {
      showAIProviderRequiredPrompt();
      return;
    }
    if (repriceError instanceof ApiError && repriceError.code === "AI_CREDENTIAL_REQUIRED" && repriceError.provider) {
      showAIKeyRequiredPrompt(
        repriceError.provider,
        `Your edits are saved. Add your ${providerDisplayName(repriceError.provider)} API key to re-check the price.`
      );
      return;
    }
    if (repriceError instanceof ApiError && repriceError.code === "AI_PROVIDER_CREDENTIAL_INVALID" && repriceError.provider) {
      showAIProviderCredentialInvalidPrompt(repriceError.provider);
      return;
    }
    Alert.alert("Edits saved", "Your edits are saved, but the price could not be re-checked right now.");
  }, [activePriceSource, draftId, form, listing.itemId, pricing, repriceForChanges, repricing, updateDetails, updatePricing]);

  return {
    ...form,
    activePriceSource,
    pricing,
    insightsEnabled,
    improving,
    improvementSummary,
    improvingAction,
    improveSummary,
    repricing,
    repricingLabel: repricing ? REPRICING_LABEL : null,
    brandHint: improvementHints.buyerTrust,
    detailsHint: improvementHints.descriptionDetails,
    setTitle: (value: string) => setField("title", value),
    setPriceInput,
    setDescription: (value: string) => setField("description", value),
    setCategory: (value: string) => setField("category", value),
    setCondition: (value: string) => setField("condition", value),
    setNegotiable: (value: boolean) => setField("negotiable", value),
    setBrandModel: (value: string) => setField("brandModel", value),
    setColor: (value: string) => setField("color", value),
    setMaterial: (value: string) => setField("material", value),
    setDimensions: (value: string) => setField("dimensions", value),
    setFlaws: (value: string) => setField("flaws", value),
    setAccessories: (value: string) => setField("accessories", value),
    setLocalPickup: (value: boolean) => setField("localPickup", value),
    setShipping: (value: boolean) => setField("shipping", value),
    applyPriceTier,
    runImprovement,
    saveEdits,
  };
}
