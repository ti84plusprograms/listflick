import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { canUseAIProvider, recheckListing } from "../services/api";
import {
  getDraftListingEdits,
  getListing,
  saveDraftListingEdits,
  saveListing,
} from "../services/storage";
import { useListingWorkspaceActions } from "../state/ListingWorkspaceContext";
import type { ImageQualityFeedback, ListingQuality, ListingWorkspaceState } from "../types/listing";
import { normalizeListingCondition } from "../utils/descriptionFormatter";
import {
  mediaSignature,
  pendingRecheck,
  qualityWithTips,
  textSignature,
  tipsFromQuality,
} from "../utils/readinessChecklist";

export const RECHECK_DEBOUNCE_MS = 1500;

type Checked = { key: string; media: string; text: string };

async function persistRecheck(
  listing: ListingWorkspaceState,
  quality: ListingQuality,
  feedback: ImageQualityFeedback[] | null,
): Promise<void> {
  const draftId = listing.itemId ?? listing.savedId ?? "current";
  // Photos changed in Manage Photos live in the draft until the listing is synced.
  const draft = feedback ? await getDraftListingEdits(draftId) : null;
  const photosInDraft = Boolean(draft?.imageUris);
  if (feedback && draft && photosInDraft) {
    await saveDraftListingEdits(draftId, { ...draft, imageQualityFeedback: feedback });
  }
  if (!listing.savedId) return;
  const stored = await getListing(listing.savedId);
  if (!stored) return;
  await saveListing({
    ...stored,
    listingQuality: quality,
    imageQualityFeedback: feedback && !photosInDraft ? feedback : stored.imageQualityFeedback,
  });
}

/**
 * Keeps the AI tips honest as the listing changes. After photos change it re-checks
 * the tips against the item's current photos; after text edits it re-checks the
 * text tips only. Debounced, and only when AI insights are on, a provider is usable and
 * the listing is on screen.
 */
export function useListingRecheck(listing: ListingWorkspaceState, insightsEnabled: boolean): { rechecking: boolean } {
  const { updateInsights, updatePhotos } = useListingWorkspaceActions();
  const [rechecking, setRechecking] = useState(false);
  // Only re-check while the listing is on screen: Manage Photos and Edit change the
  // workspace before they save, and the server only sees photos once they are saved.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  const key = listing.itemId ?? listing.savedId ?? "current";
  const media = mediaSignature(listing.imageUris);
  const text = textSignature({
    title: listing.title,
    description: listing.description,
    price: listing.activePrice,
    condition: listing.condition,
    category: listing.category,
  });
  const openTips = tipsFromQuality(listing.listingQuality).some((tip) => !tip.done);

  // What the tips were last checked against. A listing opened for the first time
  // counts as checked as-is: its tips were just written for these photos and text.
  const checkedRef = useRef<Checked | null>(null);
  if (checkedRef.current?.key !== key) {
    checkedRef.current = {
      key,
      media: listing.listingQuality?.checked_media ?? media,
      text: listing.listingQuality?.checked_text ?? text,
    };
  }

  const latestRef = useRef({ listing, key, media });
  latestRef.current = { listing, key, media };

  useEffect(() => {
    const checked = checkedRef.current;
    if (!checked) return;
    const kind = pendingRecheck({
      insightsEnabled: insightsEnabled && focused,
      running: rechecking,
      hasTips: openTips,
      media,
      text,
      checkedMedia: checked.media,
      checkedText: checked.text,
      photoCount: listing.imageUris.length,
      canSendPhotos: Boolean(listing.itemId),
    });
    if (!kind) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const start = latestRef.current;
        const startListing = start.listing;
        if (!(await canUseAIProvider().catch(() => false)) || cancelled) return;
        if (latestRef.current.key !== start.key) return;

        const withImages = kind.withImages;
        const nextChecked: Checked = {
          key: start.key,
          media: withImages ? start.media : checked.media,
          text,
        };
        setRechecking(true);
        try {
          const response = await recheckListing({
            item_id: startListing.itemId ?? null,
            title: startListing.title,
            description: startListing.description,
            category: startListing.category,
            condition: normalizeListingCondition(startListing.condition) || startListing.condition,
            asking_price: startListing.activePrice || 0,
            tips: tipsFromQuality(startListing.listingQuality),
            include_images: withImages,
          });
          if (latestRef.current.key !== start.key) return;
          checkedRef.current = nextChecked;

          const quality = qualityWithTips(latestRef.current.listing.listingQuality, response.tips, {
            media: nextChecked.media,
            text: nextChecked.text,
          });
          updateInsights({ listingQuality: quality });

          // Grades are per photo index, so only apply them if the photos did not move meanwhile.
          const feedback =
            withImages && latestRef.current.media === start.media && response.image_quality_feedback.length
              ? response.image_quality_feedback
              : null;
          if (feedback) updatePhotos({ imageQualityFeedback: feedback });

          await persistRecheck(latestRef.current.listing, quality, feedback);
        } catch (error) {
          // Like a finished check: do not retry the same state in a loop. The next edit tries again.
          if (latestRef.current.key === start.key) checkedRef.current = nextChecked;
          console.warn(`[Checklist] Re-check failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          setRechecking(false);
        }
      })();
    }, RECHECK_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    focused,
    insightsEnabled,
    key,
    listing.imageUris.length,
    listing.itemId,
    media,
    openTips,
    rechecking,
    text,
    updateInsights,
    updatePhotos,
  ]);

  return { rechecking };
}
