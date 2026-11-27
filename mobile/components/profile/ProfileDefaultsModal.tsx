import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { theme, themedStyles } from "../../constants/theme";
import { getUserProfile, saveUserProfile } from "../../services/storage";
import { useAuth } from "../../state/AuthContext";
import type { UserProfile } from "../../types/listing";
import { userProfileDefaultsFromAuth, withUserProfileDefaults } from "../../utils/userProfile";

interface ProfileDefaultsModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved?: (profile: UserProfile) => void;
}

/**
 * The one-time setup for what goes into every listing: pickup area and payment
 * methods. Same fields and storage as Settings > Edit Profile, opened in place
 * from Home and the "Ready to list" checklist.
 */
export function ProfileDefaultsModal({ visible, onClose, onSaved }: ProfileDefaultsModalProps) {
  const { user } = useAuth();
  const authDefaults = useMemo(() => userProfileDefaultsFromAuth(user), [user?.displayName, user?.email]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [pickupLocation, setPickupLocation] = useState("");
  const [paymentMethods, setPaymentMethods] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    getUserProfile(user?.uid, authDefaults).then((saved) => {
      if (!active) return;
      setProfile(saved);
      setPickupLocation(saved.pickupLocation);
      setPaymentMethods(saved.paymentMethods);
    });
    return () => {
      active = false;
    };
  }, [authDefaults, user?.uid, visible]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const next = withUserProfileDefaults(
        { ...(profile ?? {}), pickupLocation: pickupLocation.trim(), paymentMethods: paymentMethods.trim() },
        authDefaults,
      );
      await saveUserProfile(next, user?.uid);
      onSaved?.(next);
      onClose();
    } catch (error) {
      Alert.alert("Couldn't save", error instanceof Error ? error.message : "Your defaults could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Pickup and payment</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.hint}>Added to every listing for you. You can change it any time in Settings.</Text>

          <Text style={styles.label}>Preferred Pickup Location</Text>
          <TextInput
            style={styles.input}
            value={pickupLocation}
            onChangeText={setPickupLocation}
            placeholder="e.g. Near Downtown Starbucks"
            placeholderTextColor={theme.colors.textTertiary}
          />

          <Text style={styles.label}>Accepted Payment Methods</Text>
          <TextInput
            style={styles.input}
            value={paymentMethods}
            onChangeText={setPaymentMethods}
            placeholder="e.g. Cash, Venmo, Zelle"
            placeholderTextColor={theme.colors.textTertiary}
          />

          <Pressable
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            accessibilityRole="button"
            onPress={() => void save()}
            disabled={saving}
          >
            <Text style={styles.saveButtonText}>{saving ? "Saving..." : "Save"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: theme.spacing.screenPadding,
    paddingBottom: 40,
    paddingTop: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.textPrimary,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.textSecondary,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.button,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: theme.colors.textPrimary,
  },
  saveButton: {
    marginTop: 24,
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.button,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    ...theme.typography.buttonLabel,
    color: theme.colors.accentText,
  },
}));
