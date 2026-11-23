import { Link, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, Dimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AuthenticatedImage } from "../../components/AuthenticatedImage";

import { BRAND_NAME } from "../../constants/brand";
import { theme } from "../../constants/theme";
import { ListFlickMark } from "../../components/brand/ListFlickMark";
import { getAllListings, getPendingAnalysisOperation } from "../../services/storage";
import type { SavedListing } from "../../types/listing";
import type { PendingAnalysisOperation } from "../../utils/pendingAnalysis";
import { imageUrl, resolveImageUri } from "../../services/api";

const { width } = Dimensions.get("window");
const CARD_WIDTH = width * 0.45; // Approximately half the screen for recent items

function formatPrice(item: SavedListing): string {
  if (typeof item.activePrice === "number" && item.activePrice > 0) return `$${item.activePrice}`;
  if (item.priceSuggestion?.recommended_price) return `$${item.priceSuggestion.recommended_price}`;
  if (item.priceMin === 0 && item.priceMax === 0) return "No price set";
  if (item.priceMin === item.priceMax) return `$${item.priceMin}`;
  return `$${item.priceMin}–$${item.priceMax}`;
}

function thumbnailUri(item: SavedListing): string | null {
  return resolveImageUri(item.imageUris?.[0] ?? item.imageUri, item.itemId, 0);
}

export default function HomeScreen() {
  const [recentListings, setRecentListings] = useState<SavedListing[]>([]);
  const [pendingOperation, setPendingOperation] = useState<PendingAnalysisOperation | null>(null);
  const [homeDataReady, setHomeDataReady] = useState(false);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setHomeDataReady(false);
      Promise.all([getAllListings(), getPendingAnalysisOperation()]).then(([all, pending]) => {
        if (!active) return;
        // Sort by updatedAt descending and take top 5
        const sorted = all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        setRecentListings(sorted.slice(0, 5));
        setPendingOperation(pending);
        setHomeDataReady(true);
      });
      return () => {
        active = false;
        setHomeDataReady(false);
      };
    }, [])
  );

  const openListing = (item: SavedListing) => {
    router.push({
      pathname: "/review",
      params: {
        savedId: item.id,
      },
    });
  };

  const renderRecentItem = ({ item }: { item: SavedListing }) => {
    const thumb = thumbnailUri(item);
    return (
      <Pressable style={styles.recentCard} onPress={() => openListing(item)}>
        <View style={styles.recentThumbnailContainer}>
          {thumb ? (
            <AuthenticatedImage uri={thumb} style={styles.recentThumbnail} />
          ) : (
            <View style={[styles.recentThumbnail, styles.placeholderThumbnail]}>
              <Ionicons name="image-outline" size={24} color={theme.colors.textTertiary} />
            </View>
          )}
        </View>
        <View style={styles.recentTextContainer}>
          <Text style={styles.recentTitle} numberOfLines={1}>
            {item.title || "Untitled"}
          </Text>
          <Text style={styles.recentPrice}>{formatPrice(item)}</Text>
          <View style={styles.recentStatusBadge}>
            <Text style={styles.recentStatusText}>{item.status === "saved" ? "Ready to list" : "Draft"}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container} testID="home-screen">
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.overline}>{getGreeting().toUpperCase()}</Text>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{BRAND_NAME}</Text>
            <View style={styles.iconBox}>
              <ListFlickMark size={18} />
            </View>
          </View>
        </View>
      </View>

      <FlatList
        testID={homeDataReady ? "home-data-ready" : undefined}
        data={[{ key: 'content' }]}
        renderItem={() => (
          <View style={styles.scrollContent}>
            {/* Hero */}
            <View style={styles.heroSection}>
              <Text style={styles.heroTitle}>Sell something today</Text>
              <Text style={styles.heroSubtitle}>
                Turn photos into a ready-to-post listing in minutes.
              </Text>
            </View>

            {pendingOperation && (
              <Pressable
                style={styles.resumeCard}
                onPress={() => router.push({
                  pathname: "/processing",
                  params: { operationId: pendingOperation.operationId },
                })}
              >
                <View style={styles.resumeIcon}>
                  <Ionicons name="refresh" size={22} color={theme.colors.textPrimary} />
                </View>
                <View style={styles.resumeText}>
                  <Text style={styles.resumeTitle}>Resume listing</Text>
                  <Text style={styles.resumeSubtitle}>
                    Continue from {pendingOperation.imageUris.length} saved photo{pendingOperation.imageUris.length === 1 ? "" : "s"}.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            )}

            {!pendingOperation && (
              <>
                {/* Main Action Card */}
                <View style={styles.actionCard}>
                  <View style={styles.cameraCircle}>
                    <Ionicons name="camera" size={32} color={theme.colors.background} />
                  </View>
                  <Text style={styles.cardTitle}>Start a New Listing</Text>
                  <Text style={styles.cardSubtitle}>Take or upload photos to get started.</Text>

                  <Link href="/camera" asChild>
                    <Pressable style={styles.primaryButton}>
                      <Ionicons name="camera-outline" size={20} color={theme.colors.accentText} />
                      <Text style={styles.primaryButtonText}>Take Photos</Text>
                    </Pressable>
                  </Link>
                </View>

                {/* Secondary Action */}
                <Pressable
                  style={styles.secondaryAction}
                  testID="home-choose-from-library"
                  accessibilityLabel="Choose from Library"
                  onPress={() => {
                    // Pass a param to camera to immediately open picker if desired
                    router.push({ pathname: "/camera", params: { openPicker: "true" } });
                  }}
                >
                  <Ionicons name="image-outline" size={20} color={theme.colors.textPrimary} />
                  <Text style={styles.secondaryActionText}>Choose from Library</Text>
                </Pressable>
              </>
            )}

            {/* Recent Section */}
            {recentListings.length > 0 && (
              <View style={styles.recentSection}>
                <View style={styles.recentHeader}>
                  <Text style={styles.recentSectionTitle}>Recent</Text>
                  <Link href="/inventory" asChild>
                    <Pressable>
                      <Text style={styles.seeAllText}>See All <Ionicons name="chevron-forward" size={12} /></Text>
                    </Pressable>
                  </Link>
                </View>

                <FlatList
                  data={recentListings}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.recentListContent}
                  keyExtractor={(item) => item.id}
                  renderItem={renderRecentItem}
                />
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingHorizontal: theme.spacing.screenPadding,
    paddingTop: 60,
    paddingBottom: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  overline: {
    fontSize: 10,
    fontWeight: "600",
    color: theme.colors.textSecondary,
    letterSpacing: 0.5,
    marginBottom: 4,
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
  scrollContent: {
    paddingHorizontal: theme.spacing.screenPadding,
    paddingBottom: 40,
  },
  heroSection: {
    marginTop: 16,
    marginBottom: 32,
  },
  heroTitle: {
    ...theme.typography.heroTitle,
    color: theme.colors.textPrimary,
    marginBottom: 8,
  },
  heroSubtitle: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
  },
  actionCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    padding: 32,
    alignItems: "center",
    marginBottom: 24,
  },
  resumeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surface,
  },
  resumeIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  resumeText: {
    flex: 1,
  },
  resumeTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.textPrimary,
  },
  resumeSubtitle: {
    marginTop: 3,
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  cameraCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.textPrimary,
    marginBottom: 8,
  },
  cardSubtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: "center",
    marginBottom: 24,
  },
  primaryButton: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.button,
    paddingVertical: 16,
    paddingHorizontal: 24,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: {
    ...theme.typography.buttonLabel,
    color: theme.colors.accentText,
  },
  secondaryAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 40,
  },
  secondaryActionText: {
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
  recentSection: {
    marginTop: 8,
  },
  recentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  recentSectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: theme.colors.textPrimary,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
  recentListContent: {
    gap: 16,
    paddingRight: theme.spacing.screenPadding, // So the last item doesn't get cut off
  },
  recentCard: {
    width: CARD_WIDTH,
    gap: 12,
  },
  recentThumbnailContainer: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: theme.radius.photo,
    overflow: "hidden",
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  recentThumbnail: {
    width: "100%",
    height: "100%",
  },
  placeholderThumbnail: {
    alignItems: "center",
    justifyContent: "center",
  },
  recentTextContainer: {
    gap: 4,
  },
  recentTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  recentPrice: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
  recentStatusBadge: {
    backgroundColor: theme.colors.tagBackground,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
  },
  recentStatusText: {
    fontSize: 11,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
});
