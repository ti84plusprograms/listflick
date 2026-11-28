import * as Clipboard from "expo-clipboard";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ImageCarousel } from "../components/listing/ImageCarousel";
import { MarketplaceHint } from "../components/listing/MarketplaceHint";
import { ReadyChecklist } from "../components/listing/ReadyChecklist";
import { ListingQuestionsCard } from "../components/listing/ListingQuestionsCard";

import {
  ApiError,
  answerListingQuestions,
  discardPendingItem,
  getHealth,
  getItem,
  imageUrl,
  resolveImageUri,
  retryNotionSync,
  saveItemListing,
} from "../services/api";
import {
  clearPendingAnalysisOperationForItem,
  getDraftListingEdits,
  getListing,
  getUserProfile,
  saveDraftListingEdits,
  saveListing,
} from "../services/storage";
import { useAuth } from "../state/AuthContext";
import { applyUserProfileToDescription } from "../utils/descriptionFormatter";
import { userProfileDefaultsFromAuth } from "../utils/userProfile";
import {
  showAIKeyRequiredPrompt,
  showAIProviderCredentialInvalidPrompt,
  showAIProviderRequiredPrompt,
} from "../utils/aiCredentialPrompt";
import { providerDisplayName } from "../utils/aiSettingsState";
import {
  activePriceAfterAnswers,
  buildListingAnswers,
  draftAfterListingUpdate,
  listingQuestionsFromListing,
  setQuestionText,
  toggleQuestionOption,
  updateBusyLabel,
  workspaceToGeneratedListing,
  type ListingQuestion,
  type QuestionDrafts,
} from "../utils/listingQuestions";
import { theme, themedStyles } from "../constants/theme";
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
  formatMoney,
} from "../utils/reviewListing";
import {
  useListingWorkspaceActions,
  useListingWorkspaceSnapshot,
} from "../state/ListingWorkspaceContext";
import {
  type InventorySyncState,
  type ListingSnapshot,
  snapshotFromListing,
  snapshotsEqual,
} from "../utils/inventorySyncState";
import { saveListingMediaToLibrary } from "../services/imageDownload";
import {
  listingVideoFromItem,
  manageMediaLabel,
  saveMediaLabel,
} from "../utils/listingVideo";
import { invalidateAuthenticatedImageUri } from "../services/imageRetrieval";
import { formatImageDownloadResult } from "../utils/imageDownloadResult";
import type { NotionSyncStatus } from "../types/listing";
import {
  type NotionCapability,
  notionCapabilityFromHealth,
  notionSyncPresentation,
  shouldShowNotionUi,
} from "../utils/notionSyncState";

const SCREEN_WIDTH = Dimensions.get("window").width;

export default function ReviewScreen() {
  const params = useLocalSearchParams<ListingWorkspaceParams>();
  const paramsString = JSON.stringify(params);
  const initialListing = useMemo(() => parseListingWorkspaceParams(JSON.parse(paramsString)), [paramsString]);
  const insets = useSafeAreaInsets();
  const { hydrateWorkspace, updateDetails, updatePricing, updateInsights, updatePhotos } = useListingWorkspaceActions();
  const listing = useListingWorkspaceSnapshot();
  const { user } = useAuth();
  const authProfileDefaults = useMemo(
    () => userProfileDefaultsFromAuth(user),
    [user?.displayName, user?.email]
  );
  const identityRef = useRef(listing);
  identityRef.current = listing;
  // Answers can take a while; a late result must not land in a listing the seller has since opened.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [saving, setSaving] = useState(false);
  const [savingPhotos, setSavingPhotos] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [inventoryStatus, setInventoryStatus] = useState<InventorySyncState>(
    params.savedId ? "saved" : "unsaved"
  );
  const [notionPageUrl, setNotionPageUrl] = useState<string | null>(
    params.notionPageUrl ?? null
  );
  const [notionSyncStatus, setNotionSyncStatus] = useState<NotionSyncStatus | null>(null);
  const [notionCapability, setNotionCapability] = useState<NotionCapability | null>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [questions, setQuestions] = useState<ListingQuestion[]>([]);
  const [questionDrafts, setQuestionDrafts] = useState<QuestionDrafts>({});
  const [questionsBusyLabel, setQuestionsBusyLabel] = useState<string | null>(null);

  const savedSnapshotRef = useRef<ListingSnapshot | null>(
    params.lastSyncedSnapshot ? JSON.parse(params.lastSyncedSnapshot) : null
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;

      getHealth()
        .then((h) => {
          if (active) setNotionCapability(notionCapabilityFromHealth(h));
        })
        .catch(() => null);

      const loadWorkspace = async () => {
        const savedItem = initialListing.savedId && !initialListing.itemId
          ? await getListing(initialListing.savedId)
          : null;
        const loadedListing = savedItem ? savedListingToWorkspace(savedItem) : initialListing;
        const draftId = loadedListing.itemId ?? loadedListing.savedId ?? "current";

        if (!active) return;
        const alreadyHydrated =
          identityRef.current.itemId === loadedListing.itemId && loadedListing.itemId != null;
        if (!alreadyHydrated) hydrateWorkspace(loadedListing);

        const draft = await getDraftListingEdits(draftId);
        if (!active) return;
        hydrateWorkspace(applyDraftListingEdits(loadedListing, draft));

        // Look up the SavedListing from local storage to hydrate sync state.
        const storedItem = savedItem ?? await getListing(draftId);
        if (!active) return;

        // Fast path: local inventory state is independent from Notion metadata.
        if (storedItem?.status === "saved") {
          setInventoryStatus("saved");
          if (storedItem.notionPageUrl) {
            setNotionPageUrl(storedItem.notionPageUrl);
          }
          if (storedItem.lastSyncedSnapshot) {
            savedSnapshotRef.current = storedItem.lastSyncedSnapshot;
          }
        }

        // Check the authoritative backend state and hydrate Notion metadata separately.
        const itemId = loadedListing.itemId;
        if (!itemId) return;
        try {
          const item = await getItem(itemId);
          if (!active) return;
          setNotionSyncStatus(item.notion_sync);
          // The backend is authoritative for the video; keep a local copy while it is the same video.
          const backendVideo = listingVideoFromItem(item.video);
          const currentVideo = identityRef.current.video;
          if (!(currentVideo && backendVideo && currentVideo.videoId === backendVideo.videoId)) {
            updatePhotos({ video: backendVideo });
          }
          // Open questions live on the backend listing so they survive reloads.
          setQuestions(listingQuestionsFromListing(item.listing));
          if (item.status === "saved") {
            setInventoryStatus("saved");
            savedSnapshotRef.current ??= snapshotFromListing(loadedListing);
          }
          if (item.notion_sync?.status === "synced" && item.notion_sync?.page_id) {
            setNotionPageUrl(item.notion_sync.page_url ?? null);

            // Backfill local Notion metadata when an inventory record exists.
            if (storedItem) {
              await saveListing({
                ...storedItem,
                notionPageId: item.notion_sync.page_id,
                notionPageUrl: item.notion_sync.page_url ?? undefined,
                lastSyncedSnapshot: snapshotFromListing(loadedListing),
              });
            }
          }
        } catch {
          // Backend unreachable — stay in current state
        }
      };

      void loadWorkspace();

      return () => {
        active = false;
      };
    }, [hydrateWorkspace, initialListing, updatePhotos])
  );

  // Dirty detection: compare current workspace to last saved snapshot
  useEffect(() => {
    if (inventoryStatus === "unsaved" || !savedSnapshotRef.current) return;

    // Don't detect dirty state until we've hydrated the workspace with the initial listing
    // (A new listing might have null itemId, but it's "unsaved" so we return above anyway)
    if (initialListing.itemId && listing.itemId !== initialListing.itemId) return;

    const current = snapshotFromListing(listing);
    if (!snapshotsEqual(current, savedSnapshotRef.current)) {
      setInventoryStatus("dirty");
    } else if (inventoryStatus === "dirty") {
      setInventoryStatus("saved");
    }
  }, [listing.title, listing.description, listing.category, listing.condition, listing.activePrice, inventoryStatus, listing.itemId, initialListing.itemId]);

  const localImageUris = useMemo(() => {
    const uris = listing.imageUris ?? [];
    if (uris.length > 0) {
      return uris.map((uri, idx) => resolveImageUri(uri, listing.itemId, idx) ?? uri);
    }
    if (listing.imageUri) {
      const resolved = resolveImageUri(listing.imageUri, listing.itemId, 0);
      return resolved ? [resolved] : [];
    }
    if (listing.itemId) {
      return [imageUrl(`/api/items/${listing.itemId}/image`)];
    }
    return [];
  }, [listing.imageUris, listing.imageUri, listing.itemId]);
  const activePriceNumber = listing.activePrice || 0;
  const highAskPriceNumber = listing.priceSuggestion?.high_ask_price || listing.priceSuggestion?.max || activePriceNumber;
  const priceMinNumber = listing.priceSuggestion?.fast_sale_price || listing.priceSuggestion?.min || activePriceNumber;
  const showNotionUi = shouldShowNotionUi(__DEV__, notionCapability);
  const notionPresentation = useMemo(
    () => showNotionUi && notionSyncStatus
      ? notionSyncPresentation(notionSyncStatus, notionCapability)
      : null,
    [showNotionUi, notionSyncStatus, notionCapability],
  );

  const handleSave = async () => {
    if (saving || !listing.itemId) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();

      let resolvedNotionPageUrl: string | undefined = notionPageUrl ?? undefined;
      let result;
      try {
        result = await saveItemListing(listing.itemId, buildBackendListingSavePayload(listing));
      } catch (error) {
        Alert.alert("Save failed", error instanceof Error ? error.message : "Backend save failed");
        return;
      }

      const notionPageId = result.notion_page_id ?? undefined;
      setNotionSyncStatus(result.notion_sync);
      if (result.notion_sync.page_url) {
        resolvedNotionPageUrl = result.notion_sync.page_url;
        setNotionPageUrl(result.notion_sync.page_url);
      }

      const savedBase = buildSavedListing(
        { ...listing, imageUri: localImageUris[0], imageUris: localImageUris },
        now
      );
      if (!savedBase) return;
      const saved = {
        ...savedBase,
        missingChecklist: listing.missingChecklist?.length ? listing.missingChecklist : undefined,
        imageQualityFeedback: listing.imageQualityFeedback?.length ? listing.imageQualityFeedback : undefined,
        notionPageId,
        notionPageUrl: resolvedNotionPageUrl,
        lastSyncedSnapshot: snapshotFromListing(listing),
      };

      await saveListing(saved);
      hydrateWorkspace(savedListingToWorkspace(saved));
      await clearPendingAnalysisOperationForItem(listing.itemId);

      // Transition button state
      savedSnapshotRef.current = snapshotFromListing(listing);
      setInventoryStatus("saved");

      Alert.alert(
        "Saved",
        !showNotionUi
          ? "Listing saved to your inventory."
          : result.notion_sync.status === "synced"
          ? ["Listing saved to your inventory and synced to Notion.", ...(result.notion_sync.warnings ?? [])].join(" ")
          : `Listing saved to your inventory. ${notionSyncPresentation(result.notion_sync).message}`,
        [
          {
            text: "OK",
            onPress: () => {
              router.dismissAll();
              // Small delay to let the stack pop before switching tabs
              setTimeout(() => {
                router.push("/(tabs)/inventory");
              }, 0);
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert("Save failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const handleSyncChanges = async () => {
    if (saving || !listing.itemId) return;
    setSaving(true);
    try {
      const result = await saveItemListing(listing.itemId, buildBackendListingSavePayload(listing));
      setNotionSyncStatus(result.notion_sync);

      const now = new Date().toISOString();
      const savedBase = buildSavedListing(
        { ...listing, imageUri: localImageUris[0], imageUris: localImageUris },
        now
      );
      if (!savedBase) return;
      const saved = {
        ...savedBase,
        missingChecklist: listing.missingChecklist?.length ? listing.missingChecklist : undefined,
        imageQualityFeedback: listing.imageQualityFeedback?.length ? listing.imageQualityFeedback : undefined,
        notionPageId: result.notion_page_id ?? undefined,
        notionPageUrl: result.notion_sync.page_url ?? undefined,
        lastSyncedSnapshot: snapshotFromListing(listing),
      };
      await saveListing(saved);
      hydrateWorkspace(savedListingToWorkspace(saved));
      await clearPendingAnalysisOperationForItem(listing.itemId);

      if (result.notion_sync.page_url) {
        setNotionPageUrl(result.notion_sync.page_url);
      }

      savedSnapshotRef.current = snapshotFromListing(listing);
      setInventoryStatus("saved");
      Alert.alert("Synced", "Changes synced to your inventory.");
    } catch (error) {
      Alert.alert("Sync failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const handleRetryNotionSync = async () => {
    if (saving || !listing.itemId) return;
    setSaving(true);
    setNotionSyncStatus({ status: "syncing" });
    try {
      const result = await retryNotionSync(listing.itemId);
      setNotionSyncStatus(result.notion_sync);
      if (result.notion_sync.page_url) {
        setNotionPageUrl(result.notion_sync.page_url);
      }
      if (result.notion_sync.page_id) {
        const localId = listing.savedId ?? `local-${listing.itemId}`;
        const stored = await getListing(localId);
        if (stored) {
          await saveListing({
            ...stored,
            notionPageId: result.notion_sync.page_id,
            notionPageUrl: result.notion_sync.page_url ?? undefined,
          });
        }
      }
      const presentation = notionSyncPresentation(result.notion_sync);
      Alert.alert(presentation.title, presentation.message);
    } catch (error) {
      setNotionSyncStatus({ status: "failed", error_code: "network" });
      Alert.alert("Notion sync failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const questionAnswers = useMemo(
    () => buildListingAnswers(questions, questionDrafts),
    [questions, questionDrafts]
  );

  const handleSubmitAnswers = async () => {
    if (questionsBusyLabel || !listing.itemId || questionAnswers.length === 0) return;
    const startItemId = listing.itemId;
    setQuestionsBusyLabel(updateBusyLabel(questionAnswers));
    try {
      const result = await answerListingQuestions(startItemId, {
        answers: questionAnswers,
        listing: workspaceToGeneratedListing(listing),
        active_price: listing.activePrice,
        active_price_source: listing.activePriceSource ?? null,
      });
      const profile = await getUserProfile(user?.uid, authProfileDefaults);
      const description = applyUserProfileToDescription(result.listing.description, profile);
      const nextPrice = activePriceAfterAnswers(result, {
        activePrice: listing.activePrice,
        activePriceSource: listing.activePriceSource,
      });
      // The draft is keyed by this listing's id, so it is always safe to save.
      const draftId = startItemId;
      await saveDraftListingEdits(
        draftId,
        draftAfterListingUpdate(await getDraftListingEdits(draftId), {
          title: result.listing.title,
          description,
          category: result.listing.marketplace_category || listing.category,
          ...nextPrice,
          priceSuggestion: result.listing.price_suggestion,
        })
      );
      if (!mountedRef.current || identityRef.current.itemId !== startItemId) return;
      updateDetails({
        title: result.listing.title,
        description,
        category: result.listing.marketplace_category || listing.category,
      });
      updatePricing({ ...nextPrice, priceSuggestion: result.listing.price_suggestion });
      updateInsights({
        listingQuality: result.listing.listing_quality,
        missingChecklist: result.missing_checklist ?? [],
      });
      setQuestions(listingQuestionsFromListing(result.listing));
      setQuestionDrafts({});
    } catch (e) {
      if (!mountedRef.current) return;
      if (e instanceof ApiError && e.code === "AI_PROVIDER_SELECTION_REQUIRED") {
        showAIProviderRequiredPrompt();
        return;
      }
      if (e instanceof ApiError && e.code === "AI_CREDENTIAL_REQUIRED" && e.provider) {
        showAIKeyRequiredPrompt(e.provider, `Add your ${providerDisplayName(e.provider)} API key to update this listing.`);
        return;
      }
      if (e instanceof ApiError && e.code === "AI_PROVIDER_CREDENTIAL_INVALID" && e.provider) {
        showAIProviderCredentialInvalidPrompt(e.provider);
        return;
      }
      const message = e instanceof ApiError || e instanceof Error ? e.message : "Could not update listing";
      Alert.alert("Update Listing", message);
    } finally {
      if (mountedRef.current) setQuestionsBusyLabel(null);
    }
  };

  const handleSkipQuestions = () => {
    if (questionsBusyLabel) return;
    setQuestions([]);
    setQuestionDrafts({});
    if (!listing.itemId) return;
    // Clearing needs no AI key; if it fails the questions just come back next time.
    answerListingQuestions(listing.itemId, {
      dismiss: true,
      active_price: listing.activePrice,
      active_price_source: listing.activePriceSource ?? null,
    }).catch(() => null);
  };

  const handleCopyText = async () => {
    const text = `${listing.title}\n\n${listing.description}`;
    await Clipboard.setStringAsync(text);
    Alert.alert("Copied", "Listing text copied to clipboard.");
    setShowOverflow(false);
  };

  const handleShareToChat = async () => {
    const text = `${listing.title}\n\n${listing.description}`;
    try {
      await Share.share({ message: text });
    } catch (error) {
      Alert.alert("Error", "Could not share listing.");
    }
    setShowOverflow(false);
  };

  const runSavePhotos = async (urisToSave: string[], videoUri?: string | null) => {
    if (savingPhotos) return;
    setSavingPhotos(true);
    try {
      if (Platform.OS === "web") {
        Alert.alert("Not supported", "Saving photos is not supported on web.");
        return;
      }
      const MediaLibrary = await import("expo-media-library/legacy");
      const { status, canAskAgain } = await MediaLibrary.requestPermissionsAsync(
        true,
        videoUri ? ["photo", "video"] : ["photo"],
      );
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          canAskAgain === false
            ? "Allow ListFlick to add to Photos in Settings to save the photos and video."
            : "We need access to your photos to save them.",
          canAskAgain === false
            ? [
              { text: "Cancel", style: "cancel" },
              { text: "Open Settings", onPress: () => void Linking.openSettings() },
            ]
            : undefined,
        );
        return;
      }
      // Photos in listing order (cover first), then the video.
      const result = await saveListingMediaToLibrary(urisToSave, videoUri);
      const allUris = videoUri ? [...urisToSave, videoUri] : urisToSave;
      const message = formatImageDownloadResult(result);
      if (result.failures.length > 0) {
        const failedPhotoUris = result.failures
          .filter((f) => f.index < urisToSave.length)
          .map((f) => urisToSave[f.index])
          .filter(Boolean);
        const videoFailed = Boolean(videoUri) && result.failures.some((f) => f.index === urisToSave.length);
        Alert.alert(message.title, message.message, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Try Again",
            onPress: () => {
              for (const failure of result.failures) {
                if (failure.category === "authentication" || failure.category === "download") {
                  invalidateAuthenticatedImageUri(allUris[failure.index]);
                }
              }
              void runSavePhotos(failedPhotoUris, videoFailed ? videoUri : null);
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
      setShowOverflow(false);
    }
  };

  const videoSaveUri = listing.video
    ? (listing.video.uri.startsWith("/") ? imageUrl(listing.video.uri) : listing.video.uri)
    : null;

  const handleSavePhotos = () => {
    const targetUris = localImageUris.map((uri, index) => resolveImageUri(uri, listing.itemId, index) ?? uri);
    void runSavePhotos(targetUris, videoSaveUri);
  };

  const openNotionPage = async () => {
    if (notionPageUrl) {
      await Linking.openURL(notionPageUrl);
    }
    setShowOverflow(false);
  };

  const handleDiscard = () => {
    setShowOverflow(false);
    if (saving || !listing.itemId) return;
    Alert.alert(
      "Discard this listing?",
      "The unsaved listing and its uploaded photos will be permanently removed.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            setSaving(true);
            void (async () => {
              await discardPendingItem(listing.itemId!);
              await clearPendingAnalysisOperationForItem(listing.itemId!);
              router.dismissAll();
              router.replace("/(tabs)");
            })()
              .catch((error) => {
                Alert.alert(
                  "Discard failed",
                  error instanceof Error ? error.message : "Could not discard listing"
                );
              })
              .finally(() => setSaving(false));
          },
        },
      ]
    );
  };

  const navigateToEdit = () => {
    router.push({
      pathname: "/edit-listing",
      params: { ...listingWorkspaceToParams(listing), focus: "all" },
    });
  };

  const navigateToPhotos = () => {
    router.push({
      pathname: "/manage-photos",
      params: listingWorkspaceToParams(listing),
    });
  };

  const displayDescription = listing.description;
  const isDescriptionLong = displayDescription.length > 200;
  const descriptionToShow = descriptionExpanded
    ? displayDescription
    : (isDescriptionLong ? displayDescription.substring(0, 200) + "..." : displayDescription);

  return (
    <View style={styles.container}>
      {/* Custom Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.headerButton}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
          <Text style={styles.headerButtonText}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle} accessibilityLiveRegion="polite">
          {savingPhotos ? saveMediaLabel(Boolean(listing.video), true) : "Listing Preview"}
        </Text>
        <Pressable
          onPress={() => setShowOverflow(!showOverflow)}
          style={styles.headerButtonRight}
          disabled={savingPhotos}
          accessibilityLabel="More listing actions"
        >
          <Ionicons name="ellipsis-horizontal" size={24} color={theme.colors.textPrimary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Photo Carousel */}
        <ImageCarousel imageUris={localImageUris} video={listing.video} />

        <Pressable
          style={styles.managePhotosBtn}
          onPress={navigateToPhotos}
          accessibilityLabel="Manage Photos"
        >
          <Ionicons name="images-outline" size={18} color={theme.colors.textPrimary} />
          <Text style={styles.managePhotosText}>{manageMediaLabel(Boolean(listing.video))}</Text>
        </Pressable>

        {/* Core Listing Details */}
        <View style={styles.detailsContainer}>
          <ListingQuestionsCard
            questions={questions}
            drafts={questionDrafts}
            busyLabel={questionsBusyLabel}
            canSubmit={questionAnswers.length > 0}
            onToggleOption={(id, option) => setQuestionDrafts((current) => toggleQuestionOption(current, id, option))}
            onChangeText={(id, text) => setQuestionDrafts((current) => setQuestionText(current, id, text))}
            onSubmit={handleSubmitAnswers}
            onSkip={handleSkipQuestions}
          />

          <Text style={styles.titleText}>
            {listing.title || "Untitled Listing"}
          </Text>

          <View style={styles.priceRow}>
            <Text style={styles.priceText}>
              {formatMoney(activePriceNumber)}
            </Text>
            {highAskPriceNumber > activePriceNumber && (
              <Text style={styles.highAskText}>{formatMoney(highAskPriceNumber)}</Text>
            )}
          </View>

          <Text style={styles.descriptionText}>
            {descriptionToShow}
          </Text>
          {isDescriptionLong && !descriptionExpanded && (
            <Pressable onPress={() => setDescriptionExpanded(true)}>
              <Text style={styles.showMoreText}>Show more</Text>
            </Pressable>
          )}

          {/* Tags */}
          <View style={styles.tagsContainer}>
            {listing.condition && (
              <View style={styles.tagBadge}>
                <Ionicons name="checkmark-circle-outline" size={14} color={theme.colors.textSecondary} />
                <Text style={styles.tagText}>{listing.condition}</Text>
              </View>
            )}
            {listing.category && (
              <View style={styles.tagBadge}>
                <Ionicons name="pricetag-outline" size={14} color={theme.colors.textSecondary} />
                <Text style={styles.tagText}>{listing.category}</Text>
              </View>
            )}
          </View>

          <MarketplaceHint photoCount={localImageUris.length} video={listing.video} />

          <ReadyChecklist openQuestionCount={questions.length} />

          {notionPresentation && inventoryStatus !== "unsaved" && (
            <View style={styles.notionStatusCard}>
              <View style={styles.notionStatusHeader}>
                <Ionicons name="logo-buffer" size={18} color={theme.colors.textPrimary} />
                <Text style={styles.notionStatusTitle}>{notionPresentation.title}</Text>
              </View>
              <Text style={styles.notionStatusMessage}>{notionPresentation.message}</Text>
              {notionSyncStatus?.status === "synced" && (notionSyncStatus.warnings ?? []).map((warning) => (
                <View key={warning} style={styles.notionWarningRow}>
                  <Ionicons name="alert-circle-outline" size={14} color={theme.colors.warning} />
                  <Text style={styles.notionWarningText}>{warning}</Text>
                </View>
              ))}
              {notionPresentation.canRetry && (
                <Pressable onPress={handleRetryNotionSync} disabled={saving}>
                  <Text style={styles.notionStatusAction}>
                    {saving
                      ? notionSyncStatus?.status === "not_synced"
                        ? "Syncing..."
                        : "Trying again..."
                      : (notionPresentation.actionLabel ?? "Sync to Notion")}
                  </Text>
                </Pressable>
              )}
              {notionSyncStatus?.status === "synced" && notionPageUrl && (
                <Pressable onPress={openNotionPage}>
                  <Text style={styles.notionStatusAction}>Open in Notion</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Overflow Menu */}
      {showOverflow && (
        <Pressable
          style={styles.overflowOverlay}
          accessible={false}
          onPress={() => {
            if (!savingPhotos) setShowOverflow(false);
          }}
        >
          <View style={styles.overflowMenu}>
            <Pressable style={styles.overflowItem} onPress={handleCopyText} disabled={savingPhotos}>
              <Ionicons name="copy-outline" size={20} color={theme.colors.textPrimary} />
              <Text style={styles.overflowItemText}>Copy Listing Text</Text>
            </Pressable>
            <Pressable style={styles.overflowItem} onPress={handleShareToChat} disabled={savingPhotos}>
              <Ionicons name="share-outline" size={20} color={theme.colors.textPrimary} />
              <Text style={styles.overflowItemText}>Share to Chat</Text>
            </Pressable>
            <Pressable
              style={[styles.overflowItem, savingPhotos && { opacity: 0.5 }]}
              onPress={handleSavePhotos}
              disabled={savingPhotos}
              accessibilityLabel="Save Photos to Device"
            >
              <Ionicons
                name="download-outline"
                size={20}
                color={savingPhotos ? theme.colors.textSecondary : theme.colors.textPrimary}
              />
              <Text style={[styles.overflowItemText, savingPhotos && { color: theme.colors.textSecondary }]}>
                {saveMediaLabel(Boolean(listing.video), savingPhotos)}
              </Text>
            </Pressable>

            {inventoryStatus === "unsaved" && (
              <Pressable
                style={styles.overflowItem}
                onPress={handleDiscard}
                disabled={saving || savingPhotos}
              >
                <Ionicons name="trash-outline" size={20} color="#E53E3E" />
                <Text style={[styles.overflowItemText, { color: "#E53E3E" }]}>Discard Listing</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      )}

      {/* Bottom Action Bar */}
      <View style={styles.bottomBar}>
        {inventoryStatus === "unsaved" && (
          <Pressable
            style={styles.primaryButton}
            onPress={handleSave}
            disabled={saving}
            accessibilityLabel="Save to Inventory"
          >
            <Ionicons name="bookmark-outline" size={20} color={theme.colors.background} />
            <Text style={styles.primaryButtonText}>{saving ? "Saving..." : "Save to Inventory"}</Text>
          </Pressable>
        )}
        {inventoryStatus === "saved" && (
          <View style={[styles.primaryButton, styles.savedButton]}>
            <Ionicons name="checkmark-circle" size={20} color={theme.colors.textSecondary} />
            <Text style={[styles.primaryButtonText, styles.savedButtonText]}>Saved to Inventory</Text>
          </View>
        )}
        {inventoryStatus === "dirty" && (
          <Pressable style={styles.primaryButton} onPress={handleSyncChanges} disabled={saving}>
            <Ionicons name="sync-outline" size={20} color={theme.colors.background} />
            <Text style={styles.primaryButtonText}>{saving ? "Syncing..." : "Sync Changes"}</Text>
          </Pressable>
        )}
        <Pressable
          style={styles.secondaryButton}
          onPress={navigateToEdit}
          accessibilityLabel="Edit Listing"
        >
          <Ionicons name="create-outline" size={20} color={theme.colors.textPrimary} />
          <Text style={styles.secondaryButtonText}>Edit Listing</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.background,
  },
  headerButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    width: 80,
  },
  headerButtonText: {
    fontSize: 16,
    color: theme.colors.textPrimary,
  },
  headerTitle: {
    ...theme.typography.screenTitle,
    flex: 1,
    textAlign: "center",
  },
  headerButtonRight: {
    paddingHorizontal: 16,
    width: 80,
    alignItems: "flex-end",
  },
  scrollContent: {
    paddingBottom: 100,
  },
  managePhotosBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  managePhotosText: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
  detailsContainer: {
    padding: theme.spacing.screenPadding,
  },
  titleText: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.textPrimary,
    marginBottom: 8,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 16,
  },
  priceText: {
    ...theme.typography.priceDisplay,
    color: theme.colors.textPrimary,
  },
  highAskText: {
    ...theme.typography.priceStrikethrough,
    color: theme.colors.textTertiary,
  },
  descriptionText: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    marginBottom: 8,
  },
  showMoreText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.textPrimary,
    marginBottom: 16,
  },
  tagsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 16,
  },
  tagBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.tagBackground,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.chip,
    borderWidth: 1,
    borderColor: theme.colors.tagBorder,
  },
  tagText: {
    ...theme.typography.chipLabel,
    color: theme.colors.textPrimary,
  },
  notionStatusCard: {
    marginTop: 20,
    padding: 14,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surface,
    gap: 8,
  },
  notionStatusHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  notionStatusTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  notionStatusMessage: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
  },
  notionWarningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 6,
  },
  notionWarningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
  },
  notionStatusAction: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    padding: theme.spacing.screenPadding,
    paddingBottom: 32,
    backgroundColor: theme.colors.surfaceElevated,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    borderRadius: theme.radius.button,
  },
  primaryButtonText: {
    ...theme.typography.buttonLabel,
    color: theme.colors.background,
  },
  savedButton: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  savedButtonText: {
    color: theme.colors.textSecondary,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: 14,
    borderRadius: theme.radius.button,
  },
  secondaryButtonText: {
    ...theme.typography.buttonLabel,
    color: theme.colors.textPrimary,
  },
  overflowOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.2)",
    zIndex: 100,
  },
  overflowMenu: {
    position: "absolute",
    top: 90,
    right: 16,
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.radius.card,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    minWidth: 200,
    overflow: "hidden",
  },
  overflowItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  overflowItemText: {
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
  overflowItemDisabled: {
    opacity: 0.7,
  },
  overflowItemTextDisabled: {
    color: theme.colors.textTertiary,
  },
}));
