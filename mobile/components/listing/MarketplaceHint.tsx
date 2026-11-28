import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { theme, themedStyles } from "../../constants/theme";
import type { ListingVideo } from "../../types/listing";
import { marketplaceHintRows } from "../../utils/listingVideo";

/** Compact "Ready for Marketplace" hint: where each piece of media goes when posting. */
export function MarketplaceHint({ photoCount, video }: { photoCount: number; video?: ListingVideo | null }) {
  const rows = marketplaceHintRows(photoCount, video);
  if (rows.length === 0) return null;
  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.header}>
        <Ionicons name="pricetag-outline" size={16} color={theme.colors.textPrimary} />
        <Text style={styles.title}>Ready for Marketplace</Text>
      </View>
      {rows.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={styles.label}>{row.label}</Text>
          <Text style={styles.text}>{row.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  card: {
    marginTop: 16,
    padding: 14,
    gap: 6,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  label: {
    width: 48,
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  text: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
  },
}));
