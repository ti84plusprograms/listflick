import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { cleanupExpiredItems, imageUrl, permanentlyDeleteItem, resolveImageUri, restoreItem } from "../services/api";
import {
  getRecentlyDeletedListings,
  permanentlyDeleteRecentlyDeletedListing,
  restoreRecentlyDeletedListing,
} from "../services/storage";
import type { SavedListing } from "../types/listing";
import { theme } from "../constants/theme";
import { AuthenticatedImage } from "../components/AuthenticatedImage";

function thumbnailUri(item: SavedListing): string | null {
  return resolveImageUri(item.imageUris?.[0] ?? item.imageUri, item.itemId, 0);
}

function remainingText(purgeAt?: string): string {
  if (!purgeAt) return "Deletion date unavailable";
  const remaining = new Date(purgeAt).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  return days === 1 ? "Deleted permanently in 1 day" : `Deleted permanently in ${days} days`;
}

export default function RecentlyDeletedScreen() {
  const insets = useSafeAreaInsets();
  const [listings, setListings] = useState<SavedListing[]>([]);

  const loadListings = useCallback(async () => {
    const all = await getRecentlyDeletedListings();
    const now = Date.now();
    const active = all.filter((item) => !item.purgeAt || new Date(item.purgeAt).getTime() > now);
    await Promise.all(
      all.filter((item) => item.purgeAt && new Date(item.purgeAt).getTime() <= now)
        .map((item) => permanentlyDeleteRecentlyDeletedListing(item.id))
    );
    setListings(active);
    // Do not block the local screen on remote maintenance. The next focus will
    // refresh local state after any expired server records have been purged.
    void cleanupExpiredItems().catch(() => undefined);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadListings();
    }, [loadListings])
  );

  const handleRestore = (item: SavedListing) => {
    Alert.alert("Restore Listing", `Restore "${item.title || "Untitled"}" to Inventory?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Restore",
        onPress: async () => {
          try {
            if (item.itemId) {
              await restoreItem(item.itemId);
            }
            await restoreRecentlyDeletedListing(item.id);
            const remaining = listings.filter((listing) => listing.id !== item.id);
            setListings(remaining);
            if (remaining.length === 0) {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(tabs)/inventory");
              }
            }
          } catch (error) {
            Alert.alert("Restore failed", error instanceof Error ? error.message : "Could not restore listing");
          }
        },
      },
    ]);
  };

  const handlePermanentDelete = (item: SavedListing) => {
    Alert.alert("Delete Permanently", `Delete "${item.title || "Untitled"}" and its photos permanently?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete Permanently",
        style: "destructive",
        onPress: async () => {
          try {
            if (item.itemId) {
              await permanentlyDeleteItem(item.itemId);
            }
            await permanentlyDeleteRecentlyDeletedListing(item.id);
            setListings((current) => current.filter((listing) => listing.id !== item.id));
          } catch (error) {
            Alert.alert("Delete failed", error instanceof Error ? error.message : "Could not permanently delete listing");
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container} testID="recently-deleted-screen">
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} testID="recently-deleted-back">
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
          <Text style={styles.headerButtonText}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Recently Deleted</Text>
        <View style={styles.headerSpacer} />
      </View>
      {listings.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="trash-outline" size={48} color={theme.colors.textTertiary} />
          <Text style={styles.emptyTitle}>Recently Deleted is Empty</Text>
          <Text style={styles.emptyText}>Deleted listings will remain here until their retention period ends.</Text>
        </View>
      ) : (
        <FlatList
          data={listings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const thumb = thumbnailUri(item);
            return (
              <View style={styles.card}>
                {thumb ? <AuthenticatedImage uri={thumb} style={styles.thumbnail} /> : <View style={styles.thumbnailPlaceholder} />}
                <View style={styles.content}>
                  <Text style={styles.title} numberOfLines={1}>{item.title || "Untitled"}</Text>
                  <Text style={styles.meta}>{remainingText(item.purgeAt)}</Text>
                  <View style={styles.actions}>
                    <Pressable style={styles.restoreButton} onPress={() => handleRestore(item)}>
                      <Text style={styles.restoreText}>Restore</Text>
                    </Pressable>
                    <Pressable
                      style={styles.deleteButton}
                      accessibilityLabel={`Permanently delete ${item.title || "Untitled"}`}
                      onPress={() => handlePermanentDelete(item)}
                    >
                      <Text style={styles.deleteText}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.screenPadding,
    paddingBottom: 12,
  },
  headerButton: { flexDirection: "row", alignItems: "center", width: 80 },
  headerButtonText: { color: theme.colors.textPrimary, fontSize: 16, marginLeft: 4 },
  headerTitle: { ...theme.typography.screenTitle, color: theme.colors.textPrimary },
  headerSpacer: { width: 80 },
  list: { padding: theme.spacing.screenPadding, gap: 12 },
  card: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  thumbnail: { width: 76, height: 76, borderRadius: theme.radius.photo },
  thumbnailPlaceholder: { width: 76, height: 76, borderRadius: theme.radius.photo, backgroundColor: theme.colors.background },
  content: { flex: 1, justifyContent: "space-between" },
  title: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: "600" },
  meta: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 4 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 },
  restoreButton: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: theme.colors.tagBackground },
  restoreText: { color: theme.colors.textPrimary, fontWeight: "600", fontSize: 13 },
  deleteButton: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: "#FEE2E2" },
  deleteText: { color: "#B91C1C", fontWeight: "600", fontSize: 13 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  emptyTitle: { color: theme.colors.textPrimary, fontSize: 18, fontWeight: "700", marginTop: 16 },
  emptyText: { color: theme.colors.textSecondary, textAlign: "center", marginTop: 8 },
});
