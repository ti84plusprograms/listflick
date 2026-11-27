import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DraggableGrid } from "react-native-draggable-grid";
import { Ionicons } from "@expo/vector-icons";

import { AuthenticatedImage } from "../components/AuthenticatedImage";
import { PhotoViewer } from "../components/managePhotos/PhotoViewer";
import { ApiError, replaceItemImages } from "../services/api";
import { invalidateAuthenticatedImageUri } from "../services/imageRetrieval";
import {
  getDraftListingEdits,
  saveDraftListingEdits,
} from "../services/storage";
import type { ImageQualityStatus } from "../types/listing";
import {
  applyDraftListingEdits,
  parseListingWorkspaceParams,
  type ListingWorkspaceParams,
} from "../utils/listingWorkspace";
import {
  createManagePhotoEntries,
  nearestViewerPhotoKey,
  photoLoadStateAfterEnd,
  type ManagePhotoEntry,
  type PhotoLoadState,
} from "../utils/managePhotos";
import { theme } from "../constants/theme";
import { useAIInsightsEnabled } from "../state/AIInsightsContext";
import {
  useListingIdentity,
  useListingPhotos,
  useListingWorkspaceActions,
} from "../state/ListingWorkspaceContext";

const { width } = Dimensions.get("window");
const GRID_SPACING = 16;
// Calculate column width for 2 columns with padding
const COL_WIDTH = (width - theme.spacing.screenPadding * 2 - GRID_SPACING) / 2;
const FEEDBACK_HEIGHT = 28;

interface AddPhotoEntry {
  key: "add-button";
  uri: "";
  isAddButton: true;
  disabledDrag: true;
  disabledReSorted: true;
}

type PhotoGridEntry = (ManagePhotoEntry & { isAddButton: false }) | AddPhotoEntry;

function qualityLabel(status: ImageQualityStatus): string {
  if (status === "good") return "Good photo";
  if (status === "needs_improvement") return "Needs better lighting";
  return "Retake recommended";
}

function qualityIcon(status: ImageQualityStatus): keyof typeof Ionicons.glyphMap {
  if (status === "good") return "checkmark-circle";
  if (status === "needs_improvement") return "bulb";
  return "alert-circle";
}

function qualityColor(status: ImageQualityStatus) {
  if (status === "good") return theme.colors.success;
  if (status === "needs_improvement") return theme.colors.warning;
  return theme.colors.textPrimary;
}

export default function ManagePhotosScreen() {
  const params = useLocalSearchParams<ListingWorkspaceParams>();
  const paramsString = JSON.stringify(params);
  const listing = useMemo(() => parseListingWorkspaceParams(JSON.parse(paramsString)), [paramsString]);
  const insets = useSafeAreaInsets();
  const insightsEnabled = useAIInsightsEnabled();
  const identityRef = useRef(useListingIdentity());
  identityRef.current = useListingIdentity();
  const { imageUris, imageQualityFeedback } = useListingPhotos();
  const { hydrateWorkspace, updatePhotos } = useListingWorkspaceActions();
  const photos = useMemo(
    () => createManagePhotoEntries(imageUris, imageQualityFeedback),
    [imageUris, imageQualityFeedback]
  );
  const [saving, setSaving] = useState(false);
  const [selectedPhotoKey, setSelectedPhotoKey] = useState<string | null>(null);
  const [imageStates, setImageStates] = useState<Record<string, PhotoLoadState>>({});
  const [retryAttempts, setRetryAttempts] = useState<Record<string, number>>({});
  const viewerIndexRef = useRef(0);
  const suppressedItemPressRef = useRef<string | null>(null);
  const suppressedItemPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftId = listing.itemId ?? listing.savedId ?? "current";

  const ITEM_HEIGHT = COL_WIDTH + 8 + (insightsEnabled ? FEEDBACK_HEIGHT : 0);

  useEffect(() => {
    let active = true;
    
    // If context already has this item, it was hydrated by review.tsx.
    // Skip hydration to avoid overwriting with potentially truncated URL params.
    const alreadyHydrated =
      identityRef.current.itemId === listing.itemId && identityRef.current.itemId != null;
    
    if (!alreadyHydrated) {
      hydrateWorkspace(listing);
      getDraftListingEdits(draftId).then((draft) => {
        if (!active) return;
        hydrateWorkspace(applyDraftListingEdits(listing, draft));
      });
    }

    return () => { active = false; };
  }, [draftId, hydrateWorkspace, listing]);

  useEffect(() => {
    if (!selectedPhotoKey) return;
    const currentIndex = photos.findIndex((photo) => photo.key === selectedPhotoKey);
    if (currentIndex >= 0) {
      viewerIndexRef.current = currentIndex;
      return;
    }
    setSelectedPhotoKey(
      nearestViewerPhotoKey(photos, selectedPhotoKey, viewerIndexRef.current),
    );
  }, [photos, selectedPhotoKey]);

  const setImageState = (key: string, state: PhotoLoadState) => {
    setImageStates((current) => current[key] === state ? current : { ...current, [key]: state });
  };

  const finishImageLoad = (key: string) => {
    setImageStates((current) => {
      const state = photoLoadStateAfterEnd(current[key]);
      return current[key] === state ? current : { ...current, [key]: state };
    });
  };

  const suppressGridPress = (key: string) => {
    if (suppressedItemPressTimerRef.current) {
      clearTimeout(suppressedItemPressTimerRef.current);
    }
    suppressedItemPressRef.current = key;
    suppressedItemPressTimerRef.current = setTimeout(() => {
      if (suppressedItemPressRef.current === key) suppressedItemPressRef.current = null;
      suppressedItemPressTimerRef.current = null;
    }, 1_000);
  };

  const retryPhoto = (photo: ManagePhotoEntry) => {
    invalidateAuthenticatedImageUri(photo.uri);
    setImageState(photo.key, "loading");
    setRetryAttempts((current) => ({
      ...current,
      [photo.key]: (current[photo.key] ?? 0) + 1,
    }));
  };

  const openPhoto = (photo: ManagePhotoEntry) => {
    const state = imageStates[photo.key] ?? "loading";
    if (state === "error") {
      retryPhoto(photo);
      return;
    }
    viewerIndexRef.current = photos.findIndex((candidate) => candidate.key === photo.key);
    setSelectedPhotoKey(photo.key);
  };

  const addPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, 8 - photos.length),
      quality: 0.8,
    });

    if (!result.canceled) {
      updatePhotos({
        imageUris: [
          ...imageUris,
          ...result.assets.map((asset) => asset.uri),
        ].slice(0, 8),
      });
    }
  };

  const removePhoto = (index: number) => {
    if (photos.length === 1) {
      Alert.alert("Photo required", "A listing must keep at least one photo.");
      return;
    }
    const updated = photos.filter((_, photoIndex) => photoIndex !== index);
    if (photos[index]?.key === selectedPhotoKey) {
      viewerIndexRef.current = index;
      setSelectedPhotoKey(
        updated[Math.min(index, updated.length - 1)]?.key ?? null,
      );
    }
    updatePhotos({
      imageUris: updated.map((photo) => photo.uri),
      imageQualityFeedback: updated.flatMap((photo, photoIndex) =>
        photo.feedback ? [{ ...photo.feedback, image_index: photoIndex }] : []
      ),
    });
  };

  const savePhotos = async () => {
    if (saving || photos.length === 0) return;
    setSaving(true);
    try {
      const imageUris = photos.map((photo) => photo.uri);
      const itemId = identityRef.current.itemId ?? listing.itemId;
      const result = itemId
        ? await replaceItemImages(itemId, imageUris)
        : null;
      const retainedFeedback = photos.flatMap((photo, index) => photo.feedback
        ? [{ ...photo.feedback, image_index: index }]
        : []);
      const currentDraft = await getDraftListingEdits(draftId);
      await saveDraftListingEdits(draftId, {
        ...(currentDraft ?? {}),
        imageUris,
        imageQualityFeedback: result?.image_quality_feedback ?? retainedFeedback,
      });
      updatePhotos({
        imageUris,
        imageQualityFeedback: result?.image_quality_feedback ?? retainedFeedback,
      });
      router.back();
    } catch (error) {
      const message = error instanceof ApiError && error.issues?.length
        ? error.issues.join("\n")
        : error instanceof Error
          ? error.message
          : "Could not update photos";
      Alert.alert("Photo update failed", message);
    } finally {
      setSaving(false);
    }
  };

  const gridData: PhotoGridEntry[] = photos.map((photo) => ({
    ...photo,
    isAddButton: false,
  }));
  if (photos.length < 8) {
    gridData.push({
      key: "add-button",
      uri: "",
      isAddButton: true,
      disabledDrag: true,
      disabledReSorted: true,
    });
  }

  return (
    <View style={styles.container} testID="manage-photos-screen">
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.headerButton}
          testID="manage-photos-back"
          accessibilityLabel="Back to listing preview"
        >
          <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
          <Text style={styles.headerButtonText}>Preview</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Manage Photos</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* AI Banner */}
      {insightsEnabled && (
        <View style={styles.aiBanner}>
          <Ionicons name="sparkles" size={16} color={theme.colors.textPrimary} />
          <Text style={styles.aiBannerText}>AI Insights on — photo feedback shown below each photo.</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <DraggableGrid
          numColumns={2}
          itemHeight={ITEM_HEIGHT}
          data={gridData}
          onDragRelease={(data) => {
            const reordered = data.flatMap((item) => item.isAddButton ? [] : [item]);
            updatePhotos({
              imageUris: reordered.map((item) => item.uri),
              imageQualityFeedback: reordered.flatMap((item, photoIndex) =>
                item.feedback ? [{ ...item.feedback, image_index: photoIndex }] : []
              ),
            });
          }}
          onItemPress={(item) => {
            if (suppressedItemPressRef.current === item.key) {
              suppressedItemPressRef.current = null;
              return;
            }
            if (item.isAddButton) {
              addPhotos();
            } else {
              openPhoto(item);
            }
          }}
          delayLongPress={400}
          renderItem={(item, index) => {
            if (item.isAddButton) {
              return (
                <View key={item.key} style={styles.gridItem}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add photos"
                    testID="manage-photos-add"
                    onPressIn={() => suppressGridPress(item.key)}
                    onPress={() => {
                      suppressGridPress(item.key);
                      addPhotos();
                    }}
                    style={styles.addPhotosBox}
                  >
                    <Ionicons name="add" size={40} color={theme.colors.textSecondary} />
                  </Pressable>
                </View>
              );
            }

            const feedback = insightsEnabled ? item.feedback : undefined;
            const imageState = imageStates[item.key] ?? "loading";
            return (
              <View key={item.key} style={styles.gridItem}>
                <View
                  style={styles.imageWrapper}
                  testID={`manage-photos-photo-${index + 1}`}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`${imageState === "error" ? "Retry" : imageState === "loading" ? "Loading" : "Open"} photo ${index + 1} of ${photos.length}`}
                  accessibilityHint={imageState === "loading"
                    ? "Photo is loading. Double tap to open it now."
                    : "Double tap to activate. Hold and drag to reorder."}
                  accessibilityState={{ busy: imageState === "loading" }}
                  accessibilityActions={[
                    { name: "activate", label: imageState === "error" ? "Retry photo" : "View photo" },
                    { name: "remove", label: "Remove photo" },
                  ]}
                  onAccessibilityTap={() => openPhoto(item)}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === "remove") {
                      removePhoto(index);
                    } else if (event.nativeEvent.actionName === "activate") {
                      openPhoto(item);
                    }
                  }}
                >
                  <AuthenticatedImage
                    key={`${item.key}:${retryAttempts[item.key] ?? 0}`}
                    uri={item.uri}
                    style={styles.photo}
                    resizeMode="cover"
                    onSourceResolved={() => setImageState(item.key, "loaded")}
                    onLoad={() => setImageState(item.key, "loaded")}
                    onLoadEnd={() => finishImageLoad(item.key)}
                    onError={() => setImageState(item.key, "error")}
                  />

                  {imageState === "loading" && (
                    <View style={styles.imageStateOverlay} pointerEvents="none">
                      <ActivityIndicator
                        accessibilityLabel={`Loading photo ${index + 1}`}
                        color={theme.colors.textSecondary}
                      />
                    </View>
                  )}

                  {imageState === "error" && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Retry photo ${index + 1}`}
                      onPressIn={() => suppressGridPress(item.key)}
                      onPress={() => {
                        suppressGridPress(item.key);
                        retryPhoto(item);
                      }}
                      style={styles.imageErrorOverlay}
                    >
                      <Ionicons name="refresh" size={22} color={theme.colors.textPrimary} />
                      <Text style={styles.imageErrorText}>Retry</Text>
                    </Pressable>
                  )}

                  {index === 0 && (
                    <View style={styles.coverBadge}>
                      <Text style={styles.coverBadgeText}>Cover</Text>
                    </View>
                  )}

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove photo ${index + 1}`}
                    testID={`manage-photos-remove-${index + 1}`}
                    hitSlop={8}
                    onPressIn={() => suppressGridPress(item.key)}
                    style={styles.removeButton}
                    onPress={() => {
                      suppressGridPress(item.key);
                      removePhoto(index);
                    }}
                  >
                    <Ionicons name="close-circle" size={24} color="#FFFFFF" />
                    <View style={styles.removeIconScrim} />
                  </Pressable>
                </View>

                {/* Feedback */}
                {insightsEnabled && feedback && (
                  <View style={styles.feedbackRow}>
                    <Ionicons name={qualityIcon(feedback.overall_status)} size={14} color={qualityColor(feedback.overall_status)} />
                    <Text style={[styles.feedbackText, { color: qualityColor(feedback.overall_status) }]}>
                      {qualityLabel(feedback.overall_status)}
                    </Text>
                  </View>
                )}
              </View>
            );
          }}
        />

        {photos.length > 1 && (
          <Text style={styles.reorderHint}>
            Tap a photo to view it. Hold and drag to reorder. The top-left photo is your cover.
          </Text>
        )}
      </ScrollView>

      <PhotoViewer
        photos={photos}
        selectedKey={selectedPhotoKey}
        onSelectedKeyChange={setSelectedPhotoKey}
        onClose={() => setSelectedPhotoKey(null)}
      />

      {/* Bottom Bar */}
      <View style={styles.bottomBar}>
        <Pressable
          style={[styles.primaryButton, saving && styles.primaryButtonDisabled]}
          onPress={savePhotos}
          disabled={saving}
          testID="manage-photos-done"
          accessibilityLabel={saving ? "Saving photos" : "Save photo changes"}
        >
          <Text style={styles.primaryButtonText}>{saving ? "Saving..." : "Done"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    width: 100,
  },
  headerButtonText: {
    fontSize: 15,
    color: theme.colors.textSecondary,
    marginLeft: 4,
  },
  headerTitle: {
    ...theme.typography.screenTitle,
    flex: 1,
    textAlign: "center",
  },
  headerButtonRight: {
    paddingHorizontal: 16,
    width: 100,
    alignItems: "flex-end",
  },
  addPhotosText: {
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
  disabledText: {
    color: theme.colors.textTertiary,
  },
  aiBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.surface,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  aiBannerText: {
    fontSize: 13,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
  scrollContent: {
    padding: theme.spacing.screenPadding,
    paddingBottom: 100,
  },
  addPhotosBox: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: theme.radius.photo,
    backgroundColor: theme.colors.surface,
    borderWidth: 2,
    borderColor: theme.colors.borderSubtle,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyTitle: {
    fontSize: 16,
    color: theme.colors.textSecondary,
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_SPACING,
  },
  gridItem: {
    width: COL_WIDTH,
    marginBottom: 8,
  },
  imageWrapper: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: theme.radius.photo,
    overflow: "hidden",
    backgroundColor: theme.colors.surface,
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  imageStateOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  imageErrorOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: theme.colors.surface,
  },
  imageErrorText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  coverBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  coverBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  removeButton: {
    position: "absolute",
    top: 0,
    right: 0,
    zIndex: 10,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  removeIconScrim: {
    position: "absolute",
    top: 13,
    left: 13,
    width: 18,
    height: 18,
    backgroundColor: "#000",
    borderRadius: 9,
    zIndex: -1,
  },
  feedbackRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  feedbackText: {
    fontSize: 12,
    fontWeight: "500",
  },
  reorderHint: {
    textAlign: "center",
    fontSize: 13,
    color: theme.colors.textTertiary,
    marginTop: 32,
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: theme.spacing.screenPadding,
    paddingBottom: 32,
    backgroundColor: theme.colors.surfaceElevated,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  primaryButton: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.button,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    ...theme.typography.buttonLabel,
    color: theme.colors.accentText,
  },
});
