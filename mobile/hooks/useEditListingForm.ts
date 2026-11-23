import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";

import { ApiError, improveListing } from "../services/api";
import {
  getDraftListingEdits,
  getListingDefaults,
  getUserProfile,
  saveDraftDescription,
  saveDraftListingEdits,
} from "../services/storage";
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
} from "../utils/editListingForm";

type EditListingField = keyof EditListingFormState;

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
  const previousDetails = useRef(descriptionDetailsFromForm(form));
  const improvementHints = listingImprovementHints(missingChecklist, insightsEnabled);

  const setField = useCallback(<T extends EditListingField>(field: T, value: EditListingFormState[T]) => {
    setImprovementSummary("");
    setForm((current) => ({ ...current, [field]: value }));
  }, []);

  const identityRef = useRef(useListingIdentity());
  identityRef.current = useListingIdentity();

  useEffect(() => {
    let active = true;
    const alreadyHydrated =
      identityRef.current.itemId === listing.itemId && identityRef.current.itemId != null;

    if (!alreadyHydrated) {
      hydrateWorkspace(listing);
    }
    
    // For the form, we should ideally use the context state if alreadyHydrated is true,
    // but the `listing` param state is mostly fine since edit-listing doesn't use the large fields like imageQualityFeedback.
    setForm(createInitialEditListingForm({ listing, parsedDescription }));

    Promise.all([getDraftListingEdits(draftId), getListingDefaults()]).then(([draft, defaults]) => {
      if (!active) return;
      hydrateWorkspace(applyDraftListingEdits(listing, draft));
      setForm(createInitialEditListingForm({ listing, parsedDescription, draft, defaults }));
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
    async (action: ImprovementAction, customInstruction = "") => {
      if (!insightsEnabled || improving) return;
      setImproving(true);
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
        setImprovementSummary(listingImprovementSummary(appliedImprovement.changedFields));
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
        if (nextPrice > 0 && action === "make_price_more_competitive") {
          const rounded = Math.round(nextPrice);
          setField("priceInput", String(rounded));
          updatePricing({ activePrice: rounded, activePriceSource: "ai_recommended" });
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === "AI_PROVIDER_SELECTION_REQUIRED") {
          showAIProviderRequiredPrompt();
          return;
        }
        if (e instanceof ApiError && e.code === "AI_CREDENTIAL_REQUIRED" && e.provider) {
          showAIKeyRequiredPrompt(e.provider, `Add your ${e.provider === "gemini" ? "Gemini" : "Groq"} API key to improve this listing.`);
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

  const saveEdits = useCallback(async () => {
    await saveDraftListingEdits(draftId, formToDraftListingEdits(form, activePriceSource));
    await saveDraftDescription(draftId, form.description);
    updateDetails(formToWorkspaceDetails(form));
    updatePricing(formToWorkspacePricing(form, activePriceSource));
    router.back();
  }, [activePriceSource, draftId, form, updateDetails, updatePricing]);

  return {
    ...form,
    activePriceSource,
    pricing,
    insightsEnabled,
    improving,
    improvementSummary,
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
