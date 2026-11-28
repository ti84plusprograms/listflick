import { Link, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AuthenticatedImage } from "../../components/AuthenticatedImage";

import { imageUrl, resolveImageUri, trashItem } from "../../services/api";
import {
  getAllListings,
  getRecentlyDeletedListings,
  getRecentlyDeletedRetentionDays,
  moveListingToRecentlyDeleted,
  restoreRecentlyDeletedListing,
} from "../../services/storage";
import type { SavedListing } from "../../types/listing";
import { theme, themedStyles } from "../../constants/theme";
import { filterInventoryListings, statusLabel } from "../../utils/listingReadiness";
import {
  getInventoryFilter,
  setInventoryFilter,
  subscribeInventoryFilter,
} from "../../state/inventoryFilter";

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

export default function InventoryScreen() {
  const [listings, setListings] = useState<SavedListing[]>([]);
  const [hasRecentlyDeleted, setHasRecentlyDeleted] = useState(false);
  const [filter, setFilter] = useState(getInventoryFilter);

  useEffect(() => subscribeInventoryFilter(setFilter), []);

  useFocusEffect(
    useCallback(() => {
      Promise.all([getAllListings(), getRecentlyDeletedListings()]).then(([active, deleted]) => {
        setListings(active);
        setHasRecentlyDeleted(deleted.length > 0);
      });
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

  const handleDeleteListing = (item: SavedListing) => {
    Alert.alert("Remove Listing", `Remove "${item.title || "Untitled"}" from inventory?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          let movedLocally = false;
          const hasRemoteItem = Boolean(item.itemId);
          try {
            const retentionDays = await getRecentlyDeletedRetentionDays();
            const deletedAt = new Date().toISOString();
            const purgeAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
            await moveListingToRecentlyDeleted(item, deletedAt, purgeAt);
            movedLocally = true;
            setHasRecentlyDeleted(true);
            setListings((current) => current.filter((listing) => listing.id !== item.id));
            if (hasRemoteItem) {
              await trashItem(item.itemId, retentionDays);
            }
          } catch (error) {
            if (movedLocally) {
              await restoreRecentlyDeletedListing(item.id).catch(() => undefined);
              setListings((current) => [item, ...current]);
              const remainingDeleted = await getRecentlyDeletedListings();
              setHasRecentlyDeleted(remainingDeleted.length > 0);
            }
            Alert.alert("Remove failed", error instanceof Error ? error.message : "Could not remove listing");
            return;
          }
        },
      },
    ]);
  };

  const visibleListings = filterInventoryListings(listings, filter);

  const filterBar = filter === "attention" ? (
    <View style={styles.filterBar}>
      <Text style={styles.filterText}>Showing listings that need attention</Text>
      <Pressable onPress={() => setInventoryFilter(null)} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.filterAction}>Show all</Text>
      </Pressable>
    </View>
  ) : null;

  const recentlyDeletedLink = hasRecentlyDeleted && !filter ? (
    <Pressable
      style={styles.recentlyDeletedLink}
      onPress={() => router.push("/recently-deleted" as never)}
      accessibilityLabel="Recently Deleted"
    >
      <Ionicons name="trash-outline" size={18} color={theme.colors.textSecondary} />
      <Text style={styles.recentlyDeletedText}>Recently Deleted</Text>
      <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
    </Pressable>
  ) : null;

  if (filter === "attention" && visibleListings.length === 0) {
    return (
      <View style={styles.container}>
        {filterBar}
        <View style={styles.empty}>
          <Ionicons name="checkmark-circle-outline" size={48} color={theme.colors.textTertiary} style={styles.emptyIcon} />
          <Text style={styles.emptyTitle}>All caught up</Text>
          <Text style={styles.emptyText}>No listings need attention.</Text>
        </View>
      </View>
    );
  }

  if (listings.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="cube-outline" size={48} color={theme.colors.textTertiary} style={styles.emptyIcon} />
        <Text style={styles.emptyTitle}>No saved listings yet</Text>
        <Text style={styles.emptyText}>Take a photo to generate your first listing.</Text>
        <Link href="/camera" asChild>
          <Pressable style={styles.button}>
            <Ionicons name="camera-outline" size={20} color={theme.colors.background} />
            <Text style={styles.buttonText}>Take Photo</Text>
          </Pressable>
        </Link>
        {recentlyDeletedLink}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {filterBar}
      {recentlyDeletedLink}
      <FlatList
        data={visibleListings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const thumb = thumbnailUri(item);
          const title = item.title || "Untitled";
          const price = formatPrice(item);
          return (
            <View style={styles.card}>
              <Pressable
                onPress={() => openListing(item)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${title} listing, ${price}, ${statusLabel(item)}`}
                accessibilityHint="Opens listing details"
              >
                <View style={styles.cardRow}>
                  {thumb ? (
                    <AuthenticatedImage uri={thumb} style={styles.thumbnail} />
                  ) : (
                    <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                      <Ionicons name="image-outline" size={24} color={theme.colors.textTertiary} />
                    </View>
                  )}

                  <View style={styles.cardContent}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {title}
                    </Text>

                    <View style={styles.priceRow}>
                      <Text style={styles.cardMeta}>{price}</Text>
                      {item.category ? (
                        <>
                          <Text style={styles.cardMetaDot}>·</Text>
                          <Text style={styles.cardMeta} numberOfLines={1}>{item.category}</Text>
                        </>
                      ) : null}
                    </View>

                    <View style={styles.cardFooter}>
                      <View style={styles.statusBadge}>
                        <Text style={styles.statusText}>{statusLabel(item)}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </Pressable>
              <Pressable
                style={styles.removeButton}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${title} from inventory`}
                onPress={() => handleDeleteListing(item)}
              >
                <Ionicons name="trash-outline" size={16} color={theme.colors.textTertiary} />
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  list: {
    padding: theme.spacing.screenPadding,
    gap: 16,
    paddingBottom: 40,
    paddingTop: 16,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    position: "relative",
  },
  cardRow: {
    flexDirection: "row",
    gap: 12,
  },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: theme.radius.photo,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  thumbnailPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  cardContent: {
    flex: 1,
    justifyContent: "space-between",
    paddingRight: 28,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardMeta: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    flexShrink: 1,
  },
  cardMetaDot: {
    color: theme.colors.textTertiary,
    marginHorizontal: 6,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusBadge: {
    backgroundColor: theme.colors.tagBackground,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
  removeButton: {
    padding: 4,
    position: "absolute",
    right: 12,
    bottom: 12,
  },
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginHorizontal: theme.spacing.screenPadding,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: theme.radius.button,
    backgroundColor: theme.colors.surface,
  },
  filterText: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  filterAction: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  recentlyDeletedLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: theme.spacing.screenPadding,
    marginTop: 16,
    padding: 14,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  recentlyDeletedText: {
    flex: 1,
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: theme.colors.background,
  },
  emptyIcon: {
    marginBottom: 16
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.textPrimary,
    marginBottom: 8,
  },
  emptyText: {
    color: theme.colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  button: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: theme.radius.button,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  buttonText: {
    color: theme.colors.accentText,
    fontWeight: "600",
    fontSize: 16
  },
}));
