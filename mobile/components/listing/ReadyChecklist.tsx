import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { theme, themedStyles } from "../../constants/theme";
import { useListingRecheck } from "../../hooks/useListingRecheck";
import { getUserProfile } from "../../services/storage";
import { useAIInsightsEnabled } from "../../state/AIInsightsContext";
import { useAuth } from "../../state/AuthContext";
import { useListingWorkspaceSnapshot } from "../../state/ListingWorkspaceContext";
import type { ListingEditFocus, UserProfile } from "../../types/listing";
import { listingWorkspaceToParams } from "../../utils/listingWorkspace";
import { openBuyerQuestions, retakePhotoCount } from "../../utils/listingReadiness";
import {
  buildReadinessChecklist,
  tipsFromQuality,
  type ChecklistAction,
  type ChecklistItem,
} from "../../utils/readinessChecklist";
import { userProfileDefaultsFromAuth } from "../../utils/userProfile";
import { ProfileDefaultsModal } from "../profile/ProfileDefaultsModal";

const EDIT_FOCUS: Partial<Record<ChecklistAction, ListingEditFocus>> = {
  edit_title: "title",
  edit_price: "price",
  edit_description: "description_details",
  edit: "all",
};

/**
 * Live "Ready to list" score and to-do list for the listing in the workspace.
 * The workspace does not carry the AI's buyer questions, so the review screen passes how many
 * are still open in its questions card.
 */
export function ReadyChecklist({ openQuestionCount }: { openQuestionCount?: number } = {}) {
  const listing = useListingWorkspaceSnapshot();
  const insightsEnabled = useAIInsightsEnabled();
  const { user } = useAuth();
  const authDefaults = useMemo(() => userProfileDefaultsFromAuth(user), [user?.displayName, user?.email]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);
  const { rechecking } = useListingRecheck(listing, insightsEnabled);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getUserProfile(user?.uid, authDefaults).then((saved) => {
        if (active) setProfile(saved);
      });
      return () => {
        active = false;
      };
    }, [authDefaults, user?.uid])
  );

  const checklist = useMemo(
    () =>
      buildReadinessChecklist({
        title: listing.title,
        description: listing.description,
        price: listing.activePrice || 0,
        photoCount: listing.imageUris.length,
        retakePhotoCount: retakePhotoCount(listing.imageUris.length, listing.imageQualityFeedback),
        openQuestionCount: openQuestionCount ?? openBuyerQuestions(listing).length,
        pickupLocation: profile?.pickupLocation ?? "",
        paymentMethods: profile?.paymentMethods ?? "",
        insightsEnabled,
        tips: tipsFromQuality(listing.listingQuality),
        hasVideo: Boolean(listing.video),
      }),
    [insightsEnabled, listing, openQuestionCount, profile]
  );

  const todo = checklist.items.filter((item) => !item.done);
  const done = checklist.items.filter((item) => item.done);

  const go = (action: ChecklistAction) => {
    if (action === "profile") {
      setProfileVisible(true);
      return;
    }
    if (action === "photos") {
      router.push({ pathname: "/manage-photos", params: listingWorkspaceToParams(listing) });
      return;
    }
    const focus = EDIT_FOCUS[action];
    if (focus) {
      router.push({ pathname: "/edit-listing", params: { ...listingWorkspaceToParams(listing), focus } });
    }
  };

  const renderRow = (item: ChecklistItem) => {
    // Buyer questions are answered in their own card on this screen.
    const tappable = !item.done && item.action !== "questions";
    return (
      <Pressable
        key={item.key}
        style={styles.row}
        onPress={tappable ? () => go(item.action) : undefined}
        disabled={!tappable}
        accessibilityRole={tappable ? "button" : undefined}
        accessibilityState={{ checked: item.done }}
      >
        <Ionicons
          name={item.done ? "checkmark-circle" : "ellipse-outline"}
          size={18}
          color={item.done ? theme.colors.success : theme.colors.textPrimary}
          style={styles.rowIcon}
        />
        <Text style={[styles.rowText, item.done && styles.rowTextDone]}>{item.label}</Text>
        {item.aiTip && (
          <View style={styles.aiTag}>
            <Text style={styles.aiTagText}>AI tip</Text>
          </View>
        )}
        {tappable && <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />}
      </Pressable>
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="sparkles-outline" size={18} color={theme.colors.textPrimary} />
        <Text style={styles.headerTitle}>Ready to list</Text>
        <Text style={styles.score}>
          {checklist.score}/100 · {checklist.label}
        </Text>
      </View>
      <View
        style={styles.barTrack}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: checklist.score }}
      >
        <View style={[styles.barFill, { width: `${checklist.score}%` }]} />
      </View>

      {rechecking && (
        <View style={styles.row} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={theme.colors.textSecondary} style={styles.rowIcon} />
          <Text style={[styles.rowText, styles.rowTextDone]}>Re-checking your photos and tips…</Text>
        </View>
      )}

      {todo.map(renderRow)}

      {checklist.optional.map((item) => (
        <Pressable
          key={item.key}
          style={styles.row}
          onPress={() => go(item.action)}
          accessibilityRole="button"
        >
          <Ionicons name="videocam-outline" size={18} color={theme.colors.textSecondary} style={styles.rowIcon} />
          <Text style={[styles.rowText, styles.rowTextDone]}>{item.label}</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
        </Pressable>
      ))}

      {done.length > 0 && (
        <>
          <Pressable style={styles.doneToggle} onPress={() => setShowDone((value) => !value)} accessibilityRole="button">
            <Text style={styles.doneToggleText}>
              {showDone ? "Hide" : "Show"} {done.length} done
            </Text>
          </Pressable>
          {showDone && done.map(renderRow)}
        </>
      )}

      <ProfileDefaultsModal
        visible={profileVisible}
        onClose={() => setProfileVisible(false)}
        onSaved={setProfile}
      />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  card: {
    marginTop: 20,
    padding: 16,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surface,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  headerTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  score: {
    fontSize: 13,
    fontWeight: "500",
    color: theme.colors.textSecondary,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: theme.colors.background,
    marginBottom: 8,
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: theme.colors.accent,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    minHeight: 32,
    paddingVertical: 6,
  },
  rowIcon: {
    marginTop: 1,
  },
  rowText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.textPrimary,
  },
  rowTextDone: {
    color: theme.colors.textSecondary,
  },
  aiTag: {
    borderWidth: 1,
    borderColor: theme.colors.tagBorder,
    borderRadius: 8,
    paddingHorizontal: 6,
    marginTop: 1,
  },
  aiTagText: {
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.textSecondary,
  },
  doneToggle: {
    minHeight: 36,
    justifyContent: "center",
  },
  doneToggleText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
}));
