import * as Clipboard from "expo-clipboard";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Linking, Platform, Share } from "react-native";

import { resolveImageUri, retryNotionSync, saveItemListing } from "../services/api";
import {
  clearPendingAnalysisOperationForItem,
  getDraftListingEdits,
  saveListing,
} from "../services/storage";
import type { NotionSyncStatus } from "../types/listing";
import {
  applyDraftListingEdits,
  listingWorkspaceToParams,
  parseListingWorkspaceParams,
  savedListingToWorkspace,
  type ListingWorkspaceParams,
} from "../utils/listingWorkspace";
import {
  buildBackendListingSavePayload,
  buildSavedListing,
  deriveReviewListingPrices,
  listingShareText,
  saveSuccessMessage,
} from "../utils/reviewListing";
import {
  useListingIdentity,
  useListingWorkspaceActions,
  useListingWorkspaceSnapshot,
} from "../state/ListingWorkspaceContext";
import { saveListingImagesToLibrary } from "../services/imageDownload";
import { invalidateAuthenticatedImageUri } from "../services/imageRetrieval";
import { formatImageDownloadResult } from "../utils/imageDownloadResult";

export function useReviewListing() {
  const params = useLocalSearchParams<ListingWorkspaceParams>();
  const paramsString = JSON.stringify(params);
  const initialListing = useMemo(
    () => parseListingWorkspaceParams(JSON.parse(paramsString)),
    [paramsString]
  );
  const { hydrateWorkspace } = useListingWorkspaceActions();
  const listing = useListingWorkspaceSnapshot();
  const prices = useMemo(() => deriveReviewListingPrices(listing), [listing]);

  const [saving, setSaving] = useState(false);
  const [savingPhotos, setSavingPhotos] = useState(false);
  const [notionSyncStatus, setNotionSyncStatus] = useState<NotionSyncStatus>({ status: "not_synced" });

  const identityRef = useRef(useListingIdentity());
  // Keep the ref current without adding it as a dependency
  identityRef.current = useListingIdentity();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const draftId = initialListing.itemId ?? initialListing.savedId ?? "current";
      const alreadyHydrated =
        identityRef.current.itemId === initialListing.itemId && identityRef.current.itemId != null;

      if (!alreadyHydrated) {
        hydrateWorkspace(initialListing);
      }

      getDraftListingEdits(draftId).then((draft) => {
        if (!active) return;
        hydrateWorkspace(applyDraftListingEdits(initialListing, draft));
      });

      return () => {
        active = false;
      };
    }, [hydrateWorkspace, initialListing])
  );

  const handleSave = useCallback(async () => {
    if (saving || !listing.itemId) return;
    setSaving(true);
    try {
      const serverBackedImageUris = listing.imageUris.map(
        (uri, index) => resolveImageUri(uri, listing.itemId, index) ?? uri
      );
      const saved = buildSavedListing(
        {
          ...listing,
          imageUri: serverBackedImageUris[0],
          imageUris: serverBackedImageUris,
        },
        new Date().toISOString()
      );
      if (!saved) return;

      let nextNotionSyncStatus: NotionSyncStatus = { status: "not_synced" };
      try {
        const result = await saveItemListing(
          listing.itemId,
          buildBackendListingSavePayload(listing)
        );
        nextNotionSyncStatus = result.notion_sync;
        setNotionSyncStatus(result.notion_sync);
      } catch (error) {
        throw error;
      }

      await saveListing(saved);
      hydrateWorkspace(savedListingToWorkspace(saved));
      await clearPendingAnalysisOperationForItem(listing.itemId);
      Alert.alert(
        "Saved",
        saveSuccessMessage({
          backendSaveError: null,
          notionSyncStatus: nextNotionSyncStatus,
        })
      );
    } catch (error) {
      Alert.alert("Save failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }, [listing, saving]);

  const handleCopyText = useCallback(async () => {
    await Clipboard.setStringAsync(listingShareText(listing));
    Alert.alert("Copied", "Listing text copied to clipboard.");
  }, [listing]);

  const handleShareToChat = useCallback(async () => {
    const text = listingShareText(listing);
    await Clipboard.setStringAsync(text);

    try {
      if (listing.imageUris.length > 0 && Platform.OS === "ios") {
        await Share.share({
          url: listing.imageUris[0],
          message: text,
        });
      } else if (listing.imageUris.length > 0 && Platform.OS === "android") {
        const result = await Share.share({ message: text });
        if (result.action === Share.sharedAction) {
          Alert.alert(
            "Photo Not Included",
            "Listing text was shared. Attach your photo separately in the app you chose."
          );
        }
      } else {
        await Share.share({ message: text });
      }
    } catch {
      Alert.alert(
        "Listing Text Copied",
        "The share sheet was dismissed. Your listing text is still on the clipboard."
      );
    }
  }, [listing]);

  const runSavePhotos = useCallback(async (urisToSave: string[]) => {
    if (savingPhotos) return;
    setSavingPhotos(true);
    try {
      if (Platform.OS === "web") {
        Alert.alert("Not supported", "Saving photos is not supported on web.");
        return;
      }
      const MediaLibrary = await import("expo-media-library");
      const { status } = await MediaLibrary.requestPermissionsAsync(true, ["photo"]);
      if (status !== "granted") {
        Alert.alert("Permission needed", "We need access to your photos to save them.");
        return;
      }
      const result = await saveListingImagesToLibrary(urisToSave);
      const message = formatImageDownloadResult(result);
      if (result.failures.length > 0) {
        const failedUris = result.failures.map((f) => urisToSave[f.index]).filter(Boolean);
        Alert.alert(message.title, message.message, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Try Again",
            onPress: () => {
              for (const failure of result.failures) {
                if (failure.category === "authentication" || failure.category === "download") {
                  invalidateAuthenticatedImageUri(urisToSave[failure.index]);
                }
              }
              void runSavePhotos(failedUris);
            },
          },
        ]);
      } else {
        Alert.alert(message.title, message.message);
      }
    } catch {
      Alert.alert(
        "Save interrupted",
        "The save did not finish cleanly. Some photos may already be in your camera roll; check before trying again.",
      );
    } finally {
      setSavingPhotos(false);
    }
  }, [savingPhotos]);

  const handleSavePhotos = useCallback(async () => {
    const targetUris = listing.imageUris.map((uri, index) => resolveImageUri(uri, listing.itemId, index) ?? uri);
    await runSavePhotos(targetUris);
  }, [listing.imageUris, listing.itemId, runSavePhotos]);

  const handleRetryNotionSync = useCallback(async () => {
    if (!listing.itemId) return;
    setNotionSyncStatus({ status: "syncing" });
    try {
      const result = await retryNotionSync(listing.itemId);
      setNotionSyncStatus(result.notion_sync);
    } catch {
      setNotionSyncStatus({ status: "failed" });
      Alert.alert("Sync Failed", "Could not sync to Notion.");
    }
  }, [listing.itemId]);

  const openNotionPage = useCallback(async () => {
    if (notionSyncStatus.page_url) {
      await Linking.openURL(notionSyncStatus.page_url);
    }
  }, [notionSyncStatus.page_url]);

  const navigateToEdit = useCallback(() => {
    router.push({
      pathname: "/edit-listing",
      params: { ...listingWorkspaceToParams(listing), focus: "all" },
    });
  }, [listing]);

  const navigateToPhotos = useCallback(() => {
    router.push({
      pathname: "/manage-photos",
      params: listingWorkspaceToParams(listing),
    });
  }, [listing]);

  return {
    listing,
    localImageUris: listing.imageUris,
    activePriceNumber: prices.activePriceNumber,
    highAskPriceNumber: prices.highAskPriceNumber,
    priceMinNumber: prices.priceMinNumber,
    saving,
    savingPhotos,
    notionSyncStatus,
    handleSave,
    handleCopyText,
    handleShareToChat,
    handleSavePhotos,
    handleRetryNotionSync,
    openNotionPage,
    navigateToEdit,
    navigateToPhotos,
  };
}
