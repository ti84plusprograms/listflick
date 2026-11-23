import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { Alert, Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import {
  ApiError,
  discardPendingItem,
  getAnalysisJobStatus,
  getItem,
  startOrResumeAnalysis,
  uploadImages,
} from "../services/api";
import { normalizeListingCondition, applyUserProfileToDescription } from "../utils/descriptionFormatter";
import { theme } from "../constants/theme";
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
import { updatePendingAnalysisOperation } from "../utils/pendingAnalysis";
import { ListFlickMark } from "../components/brand/ListFlickMark";
import {
  showAIKeyRequiredPrompt,
  showAIProviderCredentialInvalidPrompt,
  showAIProviderRequiredPrompt,
} from "../utils/aiCredentialPrompt";

const POLL_INTERVAL_MS = 2000;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  const label = provider === "gemini" ? "Gemini" : "Groq";
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
        let operation = await getPendingAnalysisOperation();
        if (!operation || (operationId && operation.operationId !== operationId)) {
          throw new Error("This listing is no longer available to resume.");
        }
        const uris = operation.imageUris;
        const stableOperationId = operation.operationId;
        if (uris.length === 0) throw new Error("No image provided");
        setUrisToDisplay(uris);

        const persist = async (
          update: Parameters<typeof updatePendingAnalysisOperation>[1]
        ) => {
          operation = updatePendingAnalysisOperation(operation!, update);
          await savePendingAnalysisOperation(operation);
        };

        const uploadOperation = async () => {
          setStatusText("Uploading your photos…");
          await persist({ phase: "uploading", lastErrorCode: undefined });
          const uploadResult = await uploadImages(uris, stableOperationId);
          await persist({
            itemId: uploadResult.item_id,
            phase: uploadResult.status === "uploaded" ? "uploaded" : "uploading",
          });
        };

        if (!operation.itemId) {
          await uploadOperation();
          if (cancelled) return;
        }

        let result;
        try {
          result = await getItem(operation.itemId!);
        } catch (cause) {
          if (!(cause instanceof ApiError) || cause.status !== 404) throw cause;
          await persist({ itemId: undefined, phase: "selected" });
          await uploadOperation();
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

        hydrateWorkspace({
          itemId: result.id,
          imageUri: uris[0],
          imageUris: uris,
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

        Animated.timing(progressWidth, { toValue: 100, duration: 300, useNativeDriver: false }).start(() => {
          router.replace({
            pathname: "/review",
            params: {
              itemId: result.id,
              imageUri: uris[0],
              imageUris: JSON.stringify(uris),
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
          showAIKeyRequiredPrompt(e.provider, `Add your ${e.provider === "gemini" ? "Gemini" : "Groq"} API key to generate listings.`);
        }
        const message = e instanceof ApiError || e instanceof Error ? e.message : "Unknown error occurred";
        setError(message);
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
              const operation = await getPendingAnalysisOperation();
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
    <View style={styles.container} testID="processing-screen">
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
        <Text style={styles.statusTitle} testID="processing-status" accessibilityLiveRegion="polite">
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

const styles = StyleSheet.create({
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
});
