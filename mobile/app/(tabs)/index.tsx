import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AuthenticatedImage } from "../../components/AuthenticatedImage";

import { BRAND_NAME } from "../../constants/brand";
import { theme, themedStyles } from "../../constants/theme";
import { ListFlickMark } from "../../components/brand/ListFlickMark";
import { ProfileDefaultsModal } from "../../components/profile/ProfileDefaultsModal";
import {
  clearPendingAnalysisOperation,
  getAllListings,
  getPendingAnalysisOperations,
  getUserProfile,
} from "../../services/storage";
import { ApiError, discardPendingItem, resolveImageUri } from "../../services/api";
import { useAuth } from "../../state/AuthContext";
import { setInventoryFilter } from "../../state/inventoryFilter";
import type { SavedListing, UserProfile } from "../../types/listing";
import type { PendingAnalysisOperation } from "../../utils/pendingAnalysis";
import {
  HOME_ROW_LIMIT,
  buildHomeModel,
  formatListingPrice,
  listingAskingPrice,
  listingMeta,
  savedWhen,
  statusLabel,
} from "../../utils/listingReadiness";
import { userProfileDefaultsFromAuth } from "../../utils/userProfile";

const HOW_IT_WORKS = [
  ["Snap the item", "A few photos or a short video. Include any flaws."],
  ["ListFlick does the listing", "Prices come from what similar items actually sell for."],
  ["Post it", "Save the photos to your camera roll and paste the text into Marketplace."],
] as const;

function formatPrice(item: SavedListing): string {
  return formatListingPrice(listingAskingPrice(item));
}

function thumbnailUri(item: SavedListing): string | null {
  return resolveImageUri(item.imageUris?.[0] ?? item.imageUri, item.itemId, 0);
}

function pendingPhotoCount(operation: PendingAnalysisOperation): string {
  const count = operation.imageUris.length;
  return count ? `${count} photo${count === 1 ? "" : "s"}` : "";
}

type HomeRowProps = {
  thumbUri?: string | null;
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  meta: string;
  reason: string;
  tag?: string;
  ok?: boolean;
  onPress: () => void;
  onDismiss?: () => void;
  dismissLabel?: string;
};

function HomeRow({ thumbUri, icon = "image-outline", title, meta, reason, tag, ok, onPress, onDismiss, dismissLabel }: HomeRowProps) {
  return (
    <View style={styles.row}>
      <Pressable style={styles.rowMain} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${reason}`}>
        <View style={styles.rowThumb}>
          {thumbUri ? (
            <AuthenticatedImage uri={thumbUri} style={styles.rowThumbImage} />
          ) : (
            <Ionicons name={icon} size={22} color={theme.colors.textTertiary} />
          )}
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          {meta ? <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text> : null}
          <View style={styles.rowReason}>
            <Ionicons
              name={ok ? "checkmark-circle" : "alert-circle"}
              size={14}
              color={ok ? theme.colors.success : theme.colors.warning}
            />
            <Text style={styles.rowReasonText} numberOfLines={2}>
              {reason}
            </Text>
            {tag ? (
              <View style={styles.rowTag}>
                <Text style={styles.rowTagText}>{tag}</Text>
              </View>
            ) : null}
          </View>
        </View>
        {!onDismiss && <Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} />}
      </Pressable>
      {onDismiss && (
        <Pressable style={styles.rowDismiss} onPress={onDismiss} accessibilityRole="button" accessibilityLabel={dismissLabel}>
          <Ionicons name="close" size={18} color={theme.colors.textTertiary} />
        </Pressable>
      )}
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const authProfileDefaults = useMemo(
    () => userProfileDefaultsFromAuth(user),
    [user?.displayName, user?.email]
  );
  const [listings, setListings] = useState<SavedListing[]>([]);
  const [pendingOperations, setPendingOperations] = useState<PendingAnalysisOperation[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  // E2E: true only once this focus has fresh data, so Maestro never reads a stale list.
  const [dataReady, setDataReady] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setDataReady(false);
      Promise.all([
        getAllListings(),
        getPendingAnalysisOperations(),
        getUserProfile(user?.uid, authProfileDefaults),
      ]).then(([all, pending, savedProfile]) => {
        if (!active) return;
        setListings(all);
        setPendingOperations(pending);
        setProfile(savedProfile);
        setLoaded(true);
        setDataReady(true);
      });
      return () => {
        active = false;
        setDataReady(false);
      };
    }, [authProfileDefaults, user?.uid])
  );

  const model = useMemo(
    () => buildHomeModel({ listings, pendingCount: pendingOperations.length, profile }),
    [listings, pendingOperations, profile]
  );

  const openListing = (item: SavedListing) => {
    router.push({
      pathname: "/review",
      params: {
        savedId: item.id,
      },
    });
  };

  const openInventory = (filter: "attention" | null) => {
    setInventoryFilter(filter);
    router.navigate("/inventory");
  };

  const startListing = () => router.push("/camera");

  const resumePending = (operation: PendingAnalysisOperation) => {
    router.push({
      pathname: "/processing",
      params: { operationId: operation.operationId },
    });
  };

  const discardPending = (operation: PendingAnalysisOperation) => {
    Alert.alert(
      "Discard this listing?",
      "The unfinished listing and its photos will be removed.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (operation.itemId) {
                try {
                  await discardPendingItem(operation.itemId);
                } catch (error) {
                  // Already gone on the server (expired or discarded elsewhere): finish clearing it here.
                  if (!(error instanceof ApiError && error.status === 404)) throw error;
                }
              }
              await clearPendingAnalysisOperation(operation.operationId);
              setPendingOperations((current) => current.filter((item) => item.operationId !== operation.operationId));
            })().catch((error) => {
              Alert.alert("Discard failed", error instanceof Error ? error.message : "Could not discard listing");
            });
          },
        },
      ]
    );
  };

  const attentionRows: ReactNode[] = [];
  pendingOperations.forEach((operation) => {
    attentionRows.push(
      <HomeRow
        key={`pending-${operation.operationId}`}
        thumbUri={operation.imageUris[0] ?? operation.video?.frames[0]?.uri}
        title="Unfinished listing"
        meta={pendingPhotoCount(operation)}
        reason={
          operation.phase === "completed"
            ? "Written but not saved. Tap to resume"
            : "Stopped before writing. Tap to resume"
        }
        onPress={() => resumePending(operation)}
        onDismiss={() => discardPending(operation)}
        dismissLabel="Discard unfinished listing"
      />
    );
  });
  model.attention.forEach(({ listing, reason }) => {
    attentionRows.push(
      <HomeRow
        key={listing.id}
        thumbUri={thumbnailUri(listing)}
        title={listing.title || "Untitled listing"}
        meta={listingMeta([formatPrice(listing), statusLabel(listing)])}
        reason={reason.text}
        tag={reason.tag}
        onPress={() => openListing(listing)}
      />
    );
  });

  return (
    <View style={styles.container} testID="home-screen">
      <ScrollView
        testID={dataReady ? "home-data-ready" : undefined}
        contentContainerStyle={[styles.scrollContent, { paddingTop: Math.max(insets.top, 20) + 16 }]}>
        {/* Header: wordmark only, plus a one-line summary once there are listings */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>{BRAND_NAME}</Text>
          <View style={styles.iconBox}>
            <ListFlickMark size={18} />
          </View>
        </View>
        {model.summary ? (
          <Pressable
            style={styles.summary}
            onPress={() => openInventory(null)}
            accessibilityRole="button"
            accessibilityHint="Opens Inventory"
          >
            <Text style={styles.summaryText}>{model.summary}</Text>
            <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
          </Pressable>
        ) : (
          <View style={styles.summarySpacer} />
        )}

        {!loaded ? null : model.isFirstRun ? (
          <>
            <Pressable style={styles.firstRunCard} onPress={startListing} accessibilityRole="button" testID="home-new-listing">
              <View style={styles.firstRunIcon}>
                <Ionicons name="camera" size={30} color={theme.colors.accent} />
              </View>
              <View style={styles.firstRunText}>
                <Text style={styles.firstRunTitle}>Make your first listing</Text>
                <Text style={styles.firstRunSubtitle}>
                  Snap something you want to sell. ListFlick identifies it, prices it and writes the listing.
                </Text>
              </View>
              <View style={styles.firstRunFooter}>
                <View style={styles.firstRunTags}>
                  <View style={styles.firstRunTag}>
                    <Ionicons name="camera-outline" size={16} color={theme.colors.accentText} />
                    <Text style={styles.firstRunTagText}>Photos</Text>
                  </View>
                  <View style={styles.firstRunTag}>
                    <Ionicons name="videocam-outline" size={16} color={theme.colors.accentText} />
                    <Text style={styles.firstRunTagText}>Video</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={22} color={theme.colors.accentText} />
              </View>
            </Pressable>

            <View style={styles.howItWorks}>
              <Text style={styles.sectionTitle}>How it works</Text>
              {HOW_IT_WORKS.map(([stepTitle, stepText], index) => (
                <View key={stepTitle} style={styles.step}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>{index + 1}</Text>
                  </View>
                  <View style={styles.stepText}>
                    <Text style={styles.stepTitle}>{stepTitle}</Text>
                    <Text style={styles.stepBody}>{stepText}</Text>
                  </View>
                </View>
              ))}
            </View>

          </>
        ) : (
          <>
            {/* Same place as the first-run card, so the main action never moves */}
            <Pressable style={styles.newListingButton} onPress={startListing} accessibilityRole="button" testID="home-new-listing">
              <View style={styles.newListingIcon}>
                <Ionicons name="camera" size={24} color={theme.colors.accent} />
              </View>
              <View style={styles.newListingText}>
                <Text style={styles.newListingTitle}>New listing</Text>
                <Text style={styles.newListingSubtitle} numberOfLines={1}>
                  Snap a few photos. ListFlick writes the rest.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.accentText} />
            </Pressable>

            {attentionRows.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Needs attention</Text>
                  <Text style={styles.sectionCount}>{model.attentionCount}</Text>
                </View>
                {attentionRows.slice(0, HOME_ROW_LIMIT)}
                {attentionRows.length > HOME_ROW_LIMIT && model.attention.length > 0 && (
                  <Pressable style={styles.moreButton} onPress={() => openInventory("attention")} accessibilityRole="button">
                    <Text style={styles.moreText}>See all {model.attention.length}</Text>
                    <Ionicons name="chevron-forward" size={14} color={theme.colors.textPrimary} />
                  </Pressable>
                )}
              </View>
            ) : (
              <View style={styles.caughtUp}>
                <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
                <Text style={styles.caughtUpText}>
                  <Text style={styles.caughtUpBold}>All caught up.</Text> Nothing needs your attention.
                </Text>
              </View>
            )}

            {/* Ready listings always show, under anything that needs attention */}
            {model.ready.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Ready to post</Text>
                  <Text style={styles.sectionCount}>{model.ready.length}</Text>
                </View>
                {model.ready.slice(0, HOME_ROW_LIMIT).map((listing) => (
                  <HomeRow
                    key={listing.id}
                    thumbUri={thumbnailUri(listing)}
                    title={listing.title || "Untitled listing"}
                    meta={listingMeta([formatPrice(listing), savedWhen(listing.updatedAt)])}
                    reason="Ready to post"
                    ok
                    onPress={() => openListing(listing)}
                  />
                ))}
                {model.ready.length > HOME_ROW_LIMIT && (
                  <Pressable style={styles.moreButton} onPress={() => openInventory(null)} accessibilityRole="button">
                    <Text style={styles.moreText}>All {listings.length} in Inventory</Text>
                    <Ionicons name="chevron-forward" size={14} color={theme.colors.textPrimary} />
                  </Pressable>
                )}
              </View>
            )}
          </>
        )}

        {/* Setup sits at the bottom as its own pill, apart from listings */}
        {loaded && model.setupMissing && (
          <>
            <View style={styles.bottomSpacer} />
            <Pressable
              style={styles.setupPill}
              onPress={() => setProfileVisible(true)}
              accessibilityRole="button"
              accessibilityHint="Added to every listing for you"
            >
              <Ionicons name="location-outline" size={16} color={theme.colors.textPrimary} />
              <Text style={styles.setupPillText} numberOfLines={1}>
                Set up once: pickup area and payment
              </Text>
              <Ionicons name="chevron-forward" size={14} color={theme.colors.textTertiary} />
            </Pressable>
          </>
        )}
      </ScrollView>

      <ProfileDefaultsModal
        visible={profileVisible}
        onClose={() => setProfileVisible(false)}
        onSaved={setProfile}
      />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing.screenPadding,
    paddingBottom: 24,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.textPrimary,
  },
  iconBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    minHeight: 32,
    marginTop: 4,
    marginBottom: 16,
  },
  summaryText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  summarySpacer: {
    height: 24,
  },
  /* First run */
  firstRunCard: {
    gap: 16,
    paddingTop: 28,
    paddingHorizontal: 24,
    paddingBottom: 24,
    borderRadius: 20,
    backgroundColor: theme.colors.accent,
    marginBottom: 28,
  },
  firstRunIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.accentText,
    alignItems: "center",
    justifyContent: "center",
  },
  firstRunText: {
    gap: 6,
  },
  firstRunTitle: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: "800",
    color: theme.colors.accentText,
  },
  firstRunSubtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: theme.colors.accentText,
    opacity: 0.75,
  },
  firstRunFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  firstRunTags: {
    flexDirection: "row",
    gap: 8,
  },
  firstRunTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: theme.colors.accentTint,
  },
  firstRunTagText: {
    fontSize: 13,
    fontWeight: "500",
    color: theme.colors.accentText,
  },
  howItWorks: {
    gap: 16,
    marginBottom: 24,
  },
  step: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.textPrimary,
  },
  stepText: {
    flex: 1,
    gap: 2,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  stepBody: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
  },
  /* Fills leftover space so the setup pill rests at the bottom of the screen */
  bottomSpacer: {
    flex: 1,
    minHeight: 8,
  },
  setupPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  setupPillText: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  /* Has listings */
  newListingButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.accent,
    marginBottom: 28,
  },
  newListingIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.accentText,
    alignItems: "center",
    justifyContent: "center",
  },
  newListingText: {
    flex: 1,
    gap: 3,
  },
  newListingTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.accentText,
  },
  newListingSubtitle: {
    fontSize: 14,
    color: theme.colors.accentText,
    opacity: 0.75,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: theme.colors.textPrimary,
  },
  sectionCount: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    minWidth: 0,
  },
  rowThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  rowThumbImage: {
    width: "100%",
    height: "100%",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  rowMeta: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  rowReason: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowReasonText: {
    flexShrink: 1,
    fontSize: 13,
    color: theme.colors.textPrimary,
  },
  rowTag: {
    borderWidth: 1,
    borderColor: theme.colors.tagBorder,
    borderRadius: 8,
    paddingHorizontal: 6,
  },
  rowTagText: {
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.textSecondary,
  },
  rowDismiss: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  moreButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: 44,
  },
  moreText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  caughtUp: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: theme.radius.button,
    backgroundColor: theme.colors.surface,
    marginBottom: 24,
  },
  caughtUpText: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.textPrimary,
  },
  caughtUpBold: {
    fontWeight: "600",
  },
}));
