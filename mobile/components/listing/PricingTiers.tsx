import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { theme, themedStyles } from "../../constants/theme";
import type { ActivePriceSource } from "../../types/listing";

interface PricingTiersProps {
  pricing: {
    fast_sale_price?: number | null;
    recommended_price?: number | null;
    high_ask_price?: number | null;
    pricing_reason?: string | null;
  };
  activePriceSource: ActivePriceSource | undefined;
  applyPriceTier: (price: number | null | undefined, source: ActivePriceSource) => void;
}

export function PricingTiers({ pricing, activePriceSource, applyPriceTier }: PricingTiersProps) {
  const reason = pricing.pricing_reason?.trim();
  return (
    <View style={styles.wrap}>
    <View style={styles.pricingTiers}>
      <Pressable
        style={[styles.tierCard, activePriceSource === "ai_fast_sale" && styles.tierCardActive]}
        accessibilityRole="button"
        accessibilityLabel="Fast sale price"
        accessibilityState={{ selected: activePriceSource === "ai_fast_sale" }}
        onPress={() => applyPriceTier(pricing.fast_sale_price, "ai_fast_sale")}
      >
        <Text style={[styles.tierLabel, activePriceSource === "ai_fast_sale" && styles.tierTextActive]}>Fast</Text>
        <Text style={[styles.tierPrice, activePriceSource === "ai_fast_sale" && styles.tierTextActive]}>${Math.round(pricing.fast_sale_price || 0)}</Text>
      </Pressable>
      <Pressable
        style={[styles.tierCard, activePriceSource === "ai_recommended" && styles.tierCardActive]}
        accessibilityRole="button"
        accessibilityLabel="Recommended price"
        accessibilityState={{ selected: activePriceSource === "ai_recommended" }}
        onPress={() => applyPriceTier(pricing.recommended_price, "ai_recommended")}
      >
        <Text style={[styles.tierLabel, activePriceSource === "ai_recommended" && styles.tierTextActive]}>Recommended</Text>
        <Text style={[styles.tierPrice, activePriceSource === "ai_recommended" && styles.tierTextActive]}>${Math.round(pricing.recommended_price || 0)}</Text>
      </Pressable>
      <Pressable
        style={[styles.tierCard, activePriceSource === "ai_high_ask" && styles.tierCardActive]}
        accessibilityRole="button"
        accessibilityLabel="High ask price"
        accessibilityState={{ selected: activePriceSource === "ai_high_ask" }}
        onPress={() => applyPriceTier(pricing.high_ask_price, "ai_high_ask")}
      >
        <Text style={[styles.tierLabel, activePriceSource === "ai_high_ask" && styles.tierTextActive]}>High Ask</Text>
        <Text style={[styles.tierPrice, activePriceSource === "ai_high_ask" && styles.tierTextActive]}>${Math.round(pricing.high_ask_price || 0)}</Text>
      </Pressable>
    </View>
    {/* Why this price: the sold comps and condition the AI based it on. */}
    {reason ? <Text style={styles.reason}>{reason}</Text> : null}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: {
    marginBottom: 24,
  },
  pricingTiers: {
    flexDirection: "row",
    gap: 8,
  },
  reason: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    color: theme.colors.textSecondary,
  },
  tierCard: {
    flex: 1,
    padding: 12,
    borderRadius: theme.radius.photo,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
  },
  tierCardActive: {
    backgroundColor: theme.colors.accent,
  },
  tierLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: theme.colors.textSecondary,
    marginBottom: 4,
  },
  tierPrice: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.textSecondary,
  },
  tierTextActive: {
    color: theme.colors.background,
  },
}));
