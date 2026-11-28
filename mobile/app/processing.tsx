import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { Alert, Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { File } from "expo-file-system";

import {
  ApiError,
  discardPendingItem,
  getAnalysisJobStatus,
  getItem,
  startOrResumeAnalysis,
  uploadImages,
  uploadItemVideo,
  uploadVideoListing,
} from "../services/api";
import { normalizeListingCondition, applyUserProfileToDescription } from "../utils/descriptionFormatter";
import { theme, themedStyles } from "../constants/theme";
import {
  clearPendingAnalysisOperation,
  getPendingAnalysisOperation,
  getSelectedAIProvider,
  getUserProfile,
  savePendingAnalysisOperation,
} from "../services/storage";
import { useAuth } from "../state/AuthContext";
import { useListingWorkspaceActions } from "../state/ListingWorkspaceContext";
import { userProfileDefaultsFromAuth } from "../utils/userProfile";
import {
  assertPendingPhotosAvailable,
  assertPendingVideoAvailable,
  pendingOperationHasMedia,
  updatePendingAnalysisOperation,
} from "../utils/pendingAnalysis";
import { listingVideoFromItem } from "../utils/listingVideo";
import { ListFlickMark } from "../components/brand/ListFlickMark";
import { providerDisplayName } from "../utils/aiSettingsState";
import {
  showAIKeyRequiredPrompt,
  showAIProviderCredentialInvalidPrompt,
  showAIProviderRequiredPrompt,
} from "../utils/aiCredentialPrompt";
import { sendListingNotification } from "../services/notifications";
import { analysisFailedNotification, analysisFinishedNotification } from "../utils/preferences";

const POLL_INTERVAL_MS = 2000;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function localPhotoExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    // If the URI cannot be inspected, let the upload report its own error.
    return true;
  }
}

/** Tells the user, if they left the app, that this listing needs them. */
function notifyAnalysisNeedsAttention(message: string): void {
  const { kind, content } = analysisFailedNotification(message);
  void sendListingNotification(kind, content);
}

async function promptForAnalysisCredentialFailure(errorCode?: string | null): Promise<string | null> {
  if (errorCode !== "AI_CREDENTIAL_REQUIRED" && errorCode !== "AI_PROVIDER_CREDENTIAL_INVALID") {
    return null;
  }
  const provider = await getSelectedAIProvider();
  if (!provider) {
    showAIProviderRequiredPrompt();
    return "Choose an AI provider and add its API key before resuming this listing.";
  }
  const label = providerDisplayName(provider);
  if (errorCode === "AI_PROVIDER_CREDENTIAL_INVALID") {
    showAIProviderCredentialInvalidPrompt(provider);
    return `The provider rejected your ${label} API key. Replace it and try again.`;
  }
  showAIKeyRequiredPrompt(provider, `Add your ${label} API key to resume this listing.`);
  return `Add your ${label} API key to resume this listing.`;
}

export default function ProcessingScreen() {
  const { operationId } = useLocalSearchParams<{ operationId?: string }>();

  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("Preparing your photos…");
  const [retryNonce, setRetryNonce] = useState(0);
  const [progressWidth] = useState(new Animated.Value(0));
  const spinValue = useRef(new Animated.Value(0)).current;

  // Local state for UI
  const [urisToDisplay, setUrisToDisplay] = useState<string[]>([]);
  const { user } = useAuth();
  const authProfileDefaults = useMemo(
    () => userProfileDefaultsFromAuth(user),
    [user?.displayName, user?.email]
  );
  const { hydrateWorkspace } = useListingWorkspaceActions();

  useEffect(() => {
    // Progress animation (fake progress leading up to 90%, finishes at 100% on done)
    Animated.timing(progressWidth, {
      toValue: 90,
      duration: 8000,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();

    // Keep the brand mark moving while analysis is in progress.
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    let cancelled = false;

    (async () => {
      try {
        let operation = await getPendingAnalysisOperation(operationId);
        if (!operation) {
          throw new Error("This listing is no longer available to resume.");
        }
        const uris = operation.imageUris;
        const stableOperationId = operation.operationId;
        if (!pendingOperationHasMedia(operation)) throw new Error("No image provided");
        setUrisToDisplay(uris.length > 0 ? uris : (operation.video?.frames[0] ? [operation.video.frames[0].uri] : []));

        const persist = async (
          update: Parameters<typeof updatePendingAnalysisOperation>[1]
        ) => {
          operation = updatePendingAnalysisOperation(operation!, update);
          await savePendingAnalysisOperation(operation);
        };

        const uploadOperation = async () => {
          assertPendingPhotosAvailable(uris, localPhotoExists);
          assertPendingVideoAvailable(operation!.video, localPhotoExists);
          await persist({ phase: "uploading", lastErrorCode: undefined });
          const pendingVideo = operation!.video;
          if (uris.length === 0 && pendingVideo) {
            // Video only: the backend makes the sharpest frame the cover photo.
            setStatusText("Uploading your video…");
            const videoResult = await uploadVideoListing(pendingVideo, pendingVideo.frames, stableOperationId);
            await persist({
              itemId: videoResult.item_id,
              phase: videoResult.status === "uploaded" ? "uploaded" : "uploading",
              video: { ...pendingVideo, uploaded: true },
            });
            return;
          }
          setStatusText("Uploading your photos…");
          const uploadResult = await uploadImages(uris, stableOperationId);
          await persist({
            itemId: uploadResult.item_id,
            phase: uploadResult.status === "uploaded" ? "uploaded" : "uploading",
          });
        };

        // Photos first, then the listing's video (and its candidate frames) on the same item.
        const uploadPendingVideo = async () => {
          const pendingVideo = operation!.video;
          if (!pendingVideo || pendingVideo.uploaded || !operation!.itemId) return;
          assertPendingVideoAvailable(pendingVideo, localPhotoExists);
          setStatusText("Uploading your video…");
          try {
            await uploadItemVideo(operation!.itemId, pendingVideo, pendingVideo.frames);
          } catch (cause) {
            // A clip the server refuses (too large or an unsupported format) shouldn't block the
            // photos: drop the video and keep going so the listing still gets made.
            if (!(cause instanceof ApiError) || (cause.status !== 413 && cause.status !== 415)) throw cause;
            await persist({ video: undefined });
            Alert.alert(
              "Video skipped",
              cause.status === 413
                ? "The video was too large to upload, so the listing was made from your photos. You can add a shorter clip from Manage Photos."
                : "That video format isn't supported, so the listing was made from your photos."
            );
            return;
          }
          await persist({ video: { ...pendingVideo, uploaded: true } });
        };

        if (!operation.itemId) {
          await uploadOperation();
          if (cancelled) return;
        }
        await uploadPendingVideo();
        if (cancelled) return;

        let result;
        try {
          result = await getItem(operation.itemId!);
        } catch (cause) {
          if (!(cause instanceof ApiError) || cause.status !== 404) throw cause;
          await persist({
            itemId: undefined,
            phase: "selected",
            video: operation.video ? { ...operation.video, uploaded: false } : undefined,
          });
          await uploadOperation();
          if (cancelled) return;
          await uploadPendingVideo();
          if (cancelled) return;
          result = await getItem(operation.itemId!);
        }
        let job = result.analysis_job;
        while (!cancelled) {
          if (job?.status === "succeeded" && result.analysis && result.listing) break;
          if (job?.status === "retryable_failed" || job?.status === "terminal_failed") {
            const credentialMessage = await promptForAnalysisCredentialFailure(job.last_error_code);
            if (credentialMessage) {
              await persist({
                phase: job.status,
                lastErrorCode: job.last_error_code ?? undefined,
              });
              setError(credentialMessage);
              notifyAnalysisNeedsAttention(credentialMessage);
              return;
            }
          }
          if (job?.status === "terminal_failed") {
            await persist({ phase: "terminal_failed", lastErrorCode: job.last_error_code ?? undefined });
            throw new Error("Analysis could not be completed. Return home to start a new listing.");
          }

          if (result.status === "uploading") {
            setStatusText("Finishing your upload…");
            await wait(POLL_INTERVAL_MS);
            result = await getItem(operation.itemId!);
            job = result.analysis_job;
            continue;
          }

          if (!job || job.can_retry) {
            setStatusText(job ? "Retrying analysis…" : "Analyzing your item…");
            await persist({ phase: "processing", lastErrorCode: undefined });
            try {
              const kickoff = await startOrResumeAnalysis(operation.itemId!);
              job = kickoff.job;
              if (job.status === "retryable_failed") {
                await persist({
                  phase: "retryable_failed",
                  lastErrorCode: job.last_error_code ?? undefined,
                });
                const credentialMessage = await promptForAnalysisCredentialFailure(job.last_error_code);
                if (credentialMessage) {
                  setError(credentialMessage);
                  notifyAnalysisNeedsAttention(credentialMessage);
                  return;
                }
                throw new Error("Analysis was interrupted. Choose Try Again to resume this listing.");
              }
              if (job.status === "terminal_failed") {
                await persist({
                  phase: "terminal_failed",
                  lastErrorCode: job.last_error_code ?? undefined,
                });
                throw new Error("Analysis could not be completed. Discard this listing to start over.");
              }
            } catch (cause) {
              if (!(cause instanceof ApiError) || cause.status !== 504) throw cause;
              setStatusText("Checking whether analysis finished…");
            }
          } else {
            setStatusText("Analysis is still running…");
            await persist({
              phase: job.status === "retryable_failed" ? "retryable_failed" : "processing",
              lastErrorCode: job.last_error_code ?? undefined,
            });
          }

          if (job?.status === "succeeded") {
            result = await getItem(operation.itemId!);
            job = result.analysis_job;
            continue;
          }

          await wait(POLL_INTERVAL_MS);
          job = (await getAnalysisJobStatus(operation.itemId!)).job;
        }
        if (cancelled || !result.analysis || !result.listing) return;
        const analysis = result.analysis;
        const listing = result.listing;

        const profile = await getUserProfile(user?.uid, authProfileDefaults);
        const finalDescription = applyUserProfileToDescription(listing.description, profile);
        // A video-only listing's cover is a frame on the backend, not a local photo.
        const listingImageUris = uris.length > 0 ? uris : [`/api/items/${result.id}/image/0`];
        const workspaceVideo = listingVideoFromItem(result.video);

        hydrateWorkspace({
          itemId: result.id,
          imageUri: listingImageUris[0],
          imageUris: listingImageUris,
          video: workspaceVideo,
          title: listing.title,
          description: finalDescription,
          category: listing.marketplace_category,
          condition: normalizeListingCondition(analysis.condition, analysis.visible_defects.join(" ")) || analysis.condition,
          activePrice: listing.price_suggestion.recommended_price || listing.price_suggestion.max || listing.price_suggestion.min || 0,
          activePriceSource: "ai_recommended",
          priceSuggestion: listing.price_suggestion,
          listingQuality: listing.listing_quality,
          missingChecklist: result.missing_checklist ?? [],
          imageQualityFeedback: result.image_quality_feedback ?? [],
        });

        await persist({ phase: "completed" });
        const finished = analysisFinishedNotification({
          title: listing.title,
          missingCount: result.missing_checklist?.length ?? 0,
        });
        void sendListingNotification(finished.kind, finished.content);

        Animated.timing(progressWidth, { toValue: 100, duration: 300, useNativeDriver: false }).start(() => {
          router.replace({
            pathname: "/review",
            params: {
              itemId: result.id,
              imageUri: listingImageUris[0],
              imageUris: JSON.stringify(listingImageUris),
              video: workspaceVideo ? JSON.stringify(workspaceVideo) : undefined,
              title: listing.title,
              description: finalDescription,
              category: listing.marketplace_category,
              activePrice: String(listing.price_suggestion.recommended_price || listing.price_suggestion.max || listing.price_suggestion.min || 0),
              activePriceSource: "ai_recommended",
              priceMin: String(listing.price_suggestion.fast_sale_price || listing.price_suggestion.min),
              priceMax: String(listing.price_suggestion.high_ask_price || listing.price_suggestion.max),
              recommendedPrice: String(listing.price_suggestion.recommended_price || listing.price_suggestion.max || listing.price_suggestion.min || 0),
              priceSuggestion: JSON.stringify(listing.price_suggestion),
              listingQuality: JSON.stringify(listing.listing_quality),
              condition:
                normalizeListingCondition(analysis.condition, analysis.visible_defects.join(" ")) ||
                analysis.condition,
              confidence: String(analysis.confidence),
              checklist: JSON.stringify(result.missing_checklist ?? []),
              imageQualityFeedback: JSON.stringify(result.image_quality_feedback ?? []),
            },
          });
        });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === "AI_PROVIDER_SELECTION_REQUIRED") {
          showAIProviderRequiredPrompt();
        }
        if (e instanceof ApiError && e.code === "AI_CREDENTIAL_REQUIRED" && e.provider) {
          showAIKeyRequiredPrompt(e.provider, `Add your ${providerDisplayName(e.provider)} API key to generate listings.`);
        }
        const message = e instanceof ApiError || e instanceof Error ? e.message : "Unknown error occurred";
        setError(message);
        notifyAnalysisNeedsAttention(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authProfileDefaults, operationId, progressWidth, retryNonce, spinValue, user?.uid]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const confirmDiscard = () => {
    Alert.alert(
      "Discard this listing?",
      "The unfinished listing and its uploaded photos will be removed.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const operation = await getPendingAnalysisOperation(operationId);
              if (operation?.itemId) await discardPendingItem(operation.itemId);
              if (operation) await clearPendingAnalysisOperation(operation.operationId);
              router.replace("/(tabs)");
            })().catch((cause) => {
              setError(cause instanceof Error ? cause.message : "Could not discard listing");
            });
          },
        },
      ]
    );
  };

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <View style={styles.errorIcon}>
            <Ionicons name="alert-circle-outline" size={48} color={theme.colors.background} />
          </View>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
        <View style={styles.footer}>
          <Pressable
            style={styles.cancelButton}
            onPress={() => {
              setError(null);
              setRetryNonce((value) => value + 1);
            }}
          >
            <Text style={styles.cancelText}>Try Again</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} onPress={() => router.replace("/(tabs)")}>
            <Text style={styles.cancelText}>Return Home</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} onPress={confirmDiscard}>
            <Text style={styles.cancelText}>Discard Listing</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>

        {/* Photo Strip */}
        <View style={styles.photoStrip}>
          {urisToDisplay.slice(0, 3).map((uri, index) => (
            <Image key={index} source={{ uri }} style={styles.thumbnail} />
          ))}
          {urisToDisplay.length > 3 && (
            <View style={[styles.thumbnail, styles.moreThumbnail]}>
              <Text style={styles.moreText}>+{urisToDisplay.length - 3}</Text>
            </View>
          )}
        </View>

        {/* Branded loading mark */}
        <Animated.View style={[styles.logoContainer, { transform: [{ rotate: spin }] }]}>
          <ListFlickMark size={48} />
        </Animated.View>

        {/* Progress Bar */}
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                width: progressWidth.interpolate({
                  inputRange: [0, 100],
                  outputRange: ["0%", "100%"],
                }),
              },
            ]}
          />
        </View>

        {/* Status Text */}
        <Text style={styles.statusTitle} accessibilityLiveRegion="polite">
          {statusText}
        </Text>
        <Text style={styles.statusSubtitle}>You can return home and resume this listing later.</Text>
      </View>

      <View style={styles.footer}>
        <Pressable style={styles.cancelButton} onPress={() => router.replace("/(tabs)")}>
          <Text style={styles.cancelText}>Return Home</Text>
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
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  photoStrip: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: -12, // overlapping effect
    marginBottom: 48,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: theme.colors.background,
    backgroundColor: theme.colors.surface,
  },
  moreThumbnail: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface,
  },
  moreText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.textSecondary,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 40,
  },
  progressTrack: {
    width: "100%",
    height: 4,
    backgroundColor: theme.colors.surface,
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 24,
  },
  progressFill: {
    height: "100%",
    backgroundColor: theme.colors.accent,
    borderRadius: 2,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.textPrimary,
    marginBottom: 8,
  },
  statusSubtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
  errorIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.warning,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.textPrimary,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 15,
    color: theme.colors.textSecondary,
    textAlign: "center",
  },
  footer: {
    padding: theme.spacing.screenPadding,
    paddingBottom: 40,
    alignItems: "center",
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.textSecondary,
  },
}));
