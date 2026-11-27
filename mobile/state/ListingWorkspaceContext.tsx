import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Context,
  type ReactNode,
} from "react";

import type {
  ActivePriceSource,
  ChecklistItem,
  ImageQualityFeedback,
  ListingQuality,
  ListingVideo,
  ListingWorkspaceState,
  PriceSuggestion,
} from "../types/listing";

export interface ListingIdentityState {
  itemId?: string;
  savedId?: string;
  imageUri?: string;
}

export interface ListingDetailsState {
  title: string;
  description: string;
  category: string;
  condition: string;
}

export interface ListingPricingState {
  activePrice: number;
  activePriceSource?: ActivePriceSource;
  priceSuggestion?: PriceSuggestion | null;
}

export interface ListingInsightsState {
  listingQuality?: ListingQuality | null;
  missingChecklist: ChecklistItem[];
}

export interface ListingPhotosState {
  imageUris: string[];
  imageQualityFeedback: ImageQualityFeedback[];
  /** The listing's one video (Marketplace's separate "Add video" slot). */
  video?: ListingVideo | null;
}

interface ListingWorkspaceActions {
  hydrateWorkspace: (listing: ListingWorkspaceState) => void;
  updateDetails: (details: Partial<ListingDetailsState>) => void;
  updatePricing: (pricing: Partial<ListingPricingState>) => void;
  updateInsights: (insights: Partial<ListingInsightsState>) => void;
  updatePhotos: (photos: Partial<ListingPhotosState>) => void;
}

const EMPTY_IDENTITY: ListingIdentityState = {};
const EMPTY_DETAILS: ListingDetailsState = {
  title: "",
  description: "",
  category: "",
  condition: "",
};
const EMPTY_PRICING: ListingPricingState = {
  activePrice: 0,
  activePriceSource: undefined,
  priceSuggestion: null,
};
const EMPTY_INSIGHTS: ListingInsightsState = {
  listingQuality: null,
  missingChecklist: [],
};
const EMPTY_PHOTOS: ListingPhotosState = {
  imageUris: [],
  imageQualityFeedback: [],
  video: null,
};

const IdentityContext = createContext<ListingIdentityState | null>(null);
const DetailsContext = createContext<ListingDetailsState | null>(null);
const PricingContext = createContext<ListingPricingState | null>(null);
const InsightsContext = createContext<ListingInsightsState | null>(null);
const PhotosContext = createContext<ListingPhotosState | null>(null);
const ActionsContext = createContext<ListingWorkspaceActions | null>(null);

function identityFromListing(listing: ListingWorkspaceState): ListingIdentityState {
  return {
    itemId: listing.itemId,
    savedId: listing.savedId,
    imageUri: listing.imageUris[0] ?? listing.imageUri,
  };
}

function detailsFromListing(listing: ListingWorkspaceState): ListingDetailsState {
  return {
    title: listing.title,
    description: listing.description,
    category: listing.category,
    condition: listing.condition,
  };
}

function pricingFromListing(listing: ListingWorkspaceState): ListingPricingState {
  return {
    activePrice: listing.activePrice,
    activePriceSource: listing.activePriceSource,
    priceSuggestion: listing.priceSuggestion,
  };
}

function insightsFromListing(listing: ListingWorkspaceState): ListingInsightsState {
  return {
    listingQuality: listing.listingQuality,
    missingChecklist: listing.missingChecklist,
  };
}

function photosFromListing(listing: ListingWorkspaceState): ListingPhotosState {
  return {
    imageUris: listing.imageUris,
    imageQualityFeedback: listing.imageQualityFeedback,
    video: listing.video ?? null,
  };
}

export function ListingWorkspaceProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<ListingIdentityState>(EMPTY_IDENTITY);
  const [details, setDetails] = useState<ListingDetailsState>(EMPTY_DETAILS);
  const [pricing, setPricing] = useState<ListingPricingState>(EMPTY_PRICING);
  const [insights, setInsights] = useState<ListingInsightsState>(EMPTY_INSIGHTS);
  const [photos, setPhotos] = useState<ListingPhotosState>(EMPTY_PHOTOS);

  const hydrateWorkspace = useCallback((listing: ListingWorkspaceState) => {
    setIdentity(identityFromListing(listing));
    setDetails(detailsFromListing(listing));
    setPricing(pricingFromListing(listing));
    setInsights(insightsFromListing(listing));
    setPhotos(photosFromListing(listing));
  }, []);

  const updateDetails = useCallback((nextDetails: Partial<ListingDetailsState>) => {
    setDetails((current) => ({ ...current, ...nextDetails }));
  }, []);

  const updatePricing = useCallback((nextPricing: Partial<ListingPricingState>) => {
    setPricing((current) => ({ ...current, ...nextPricing }));
  }, []);

  const updateInsights = useCallback((nextInsights: Partial<ListingInsightsState>) => {
    setInsights((current) => ({ ...current, ...nextInsights }));
  }, []);

  const updatePhotos = useCallback((nextPhotos: Partial<ListingPhotosState>) => {
    setPhotos((current) => {
      const merged = { ...current, ...nextPhotos };
      return {
        imageUris: merged.imageUris,
        imageQualityFeedback: merged.imageQualityFeedback,
        video: merged.video ?? null,
      };
    });
  }, []);

  const actions = useMemo(
    () => ({ hydrateWorkspace, updateDetails, updatePricing, updateInsights, updatePhotos }),
    [hydrateWorkspace, updateDetails, updatePricing, updateInsights, updatePhotos]
  );

  return (
    <ActionsContext.Provider value={actions}>
      <IdentityContext.Provider value={identity}>
        <DetailsContext.Provider value={details}>
          <PricingContext.Provider value={pricing}>
            <InsightsContext.Provider value={insights}>
              <PhotosContext.Provider value={photos}>{children}</PhotosContext.Provider>
            </InsightsContext.Provider>
          </PricingContext.Provider>
        </DetailsContext.Provider>
      </IdentityContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useListingIdentity(): ListingIdentityState {
  return useRequiredContext(IdentityContext, "useListingIdentity");
}

export function useListingDetails(): ListingDetailsState {
  return useRequiredContext(DetailsContext, "useListingDetails");
}

export function useListingPricing(): ListingPricingState {
  return useRequiredContext(PricingContext, "useListingPricing");
}

export function useListingInsights(): ListingInsightsState {
  return useRequiredContext(InsightsContext, "useListingInsights");
}

export function useListingPhotos(): ListingPhotosState {
  return useRequiredContext(PhotosContext, "useListingPhotos");
}

export function useListingWorkspaceActions(): ListingWorkspaceActions {
  return useRequiredContext(ActionsContext, "useListingWorkspaceActions");
}

export function useListingWorkspaceSnapshot(): ListingWorkspaceState {
  const identity = useListingIdentity();
  const details = useListingDetails();
  const pricing = useListingPricing();
  const insights = useListingInsights();
  const photos = useListingPhotos();

  return useMemo(
    () => ({
      itemId: identity.itemId,
      savedId: identity.savedId,
      imageUri: photos.imageUris[0] ?? identity.imageUri,
      imageUris: photos.imageUris,
      title: details.title,
      description: details.description,
      category: details.category,
      condition: details.condition,
      activePrice: pricing.activePrice,
      activePriceSource: pricing.activePriceSource,
      priceSuggestion: pricing.priceSuggestion,
      listingQuality: insights.listingQuality,
      missingChecklist: insights.missingChecklist,
      imageQualityFeedback: photos.imageQualityFeedback,
      video: photos.video ?? null,
    }),
    [identity, details, pricing, insights, photos]
  );
}

function useRequiredContext<T>(context: Context<T | null>, hookName: string): T {
  const value = useContext(context);
  if (!value) {
    throw new Error(`${hookName} must be used within ListingWorkspaceProvider`);
  }
  return value;
}
