import React from "react";
import { View, Text, Switch, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme, themedStyles } from "../../constants/theme";

interface LogisticsProps {
  localPickup: boolean;
  setLocalPickup: (val: boolean) => void;
  shipping: boolean;
  setShipping: (val: boolean) => void;
}

export function Logistics({ localPickup, setLocalPickup, shipping, setShipping }: LogisticsProps) {
  return (
    <View style={styles.logisticsContainer}>
      <View style={styles.logisticsRow}>
        <View style={styles.logisticsLabelGroup}>
          <Ionicons name="location-outline" size={20} color={theme.colors.textPrimary} />
          <Text style={styles.logisticsLabel}>Local Pickup</Text>
        </View>
        <Switch value={localPickup} onValueChange={setLocalPickup} trackColor={{ true: theme.colors.accent }} thumbColor={theme.colors.switchThumb} />
      </View>
      <View style={styles.logisticsDivider} />
      <View style={styles.logisticsRow}>
        <View style={styles.logisticsLabelGroup}>
          <Ionicons name="cube-outline" size={20} color={theme.colors.textPrimary} />
          <Text style={styles.logisticsLabel}>Shipping</Text>
        </View>
        <Switch value={shipping} onValueChange={setShipping} trackColor={{ true: theme.colors.accent }} thumbColor={theme.colors.switchThumb} />
      </View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  logisticsContainer: {
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.background,
    overflow: "hidden",
  },
  logisticsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  logisticsDivider: {
    height: 1,
    backgroundColor: theme.colors.borderSubtle,
    marginLeft: 48,
  },
  logisticsLabelGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  logisticsLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
}));
