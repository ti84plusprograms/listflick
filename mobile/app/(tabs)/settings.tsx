import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { getApp } from "@react-native-firebase/app";
import { getAuth, signOut } from "@react-native-firebase/auth";
import { ApiError, deleteAccount, getHealth } from "../../services/api";
import {
  deleteProviderApiKey,
  getProviderApiKey,
  setProviderApiKey,
  AI_PROVIDERS,
  isAIProvider,
  type AIProvider,
} from "../../services/aiCredentials";

import {
  EMPTY_USER_PROFILE,
  getListingDefaults,
  getDeveloperNotionMode,
  getRecentlyDeletedRetentionDays,
  getNotificationPreferences,
  saveNotificationPreferences,
  getSelectedAIProvider,
  getUserProfile,
  saveListingDefaults,
  saveDeveloperNotionMode,
  saveRecentlyDeletedRetentionDays,
  saveSelectedAIProvider,
  saveUserProfile,
  clearLocalUserData,
} from "../../services/storage";
import type { NotionCapability, UserProfile } from "../../types/listing";
import { theme, themedStyles } from "../../constants/theme";
import { useAIInsightsSettings } from "../../state/AIInsightsContext";
import { useAuth } from "../../state/AuthContext";
import { useAppearance } from "../../state/AppearanceContext";
import { requestNotificationPermission } from "../../services/notifications";
import { showNotImplemented } from "../../utils/notImplemented";
import { getSettingsSnapshot, snapshotProfileFor, updateSettingsSnapshot } from "../../utils/settingsSnapshot";
import {
  CURRENCY_MESSAGE,
  CURRENCY_TITLE,
  colorSchemeLabel,
  notificationsLabel,
  type NotificationPreferences,
} from "../../utils/preferences";
import {
  isUserProfileComplete,
  userProfileDefaultsFromAuth,
  withUserProfileDefaults,
} from "../../utils/userProfile";
import { authDebugLog, authDebugWarn, describeAuthUser } from "../../utils/authDebug";
import {
  effectiveNotionCapability,
  notionCapabilityFromHealth,
  notionCapabilitySubtitle,
  shouldShowNotionUi,
} from "../../utils/notionSyncState";
import {
  buildSupportEmailBody,
  buildSupportMailtoUrl,
  SUPPORT_EMAIL,
} from "../../utils/supportEmail";
import { aiSettingsPresentation, providerDisplayName } from "../../utils/aiSettingsState";
import { isServerAIKeyFallbackAvailable } from "../../utils/aiProviderAvailability";

const APP_VERSION = "1.0.4";

/* ── Reusable row components ───────────────────────────────── */

function ToggleRow({
  icon,
  label,
  subtitle,
  value,
  onValueChange,
  disabled,
  isLast,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  isLast?: boolean;
}) {
  return (
    <>
      <View style={[styles.groupRow, disabled && { opacity: 0.6 }]}>
        <Ionicons name={icon} size={20} color={theme.colors.textPrimary} style={styles.groupRowIcon} />
        <View style={styles.groupRowContent}>
          <Text style={styles.groupRowLabel}>{label}</Text>
          {subtitle ? <Text style={styles.groupRowSub}>{subtitle}</Text> : null}
        </View>
        <Switch
          accessibilityLabel={`${label}, ${value ? "On" : "Off"}`}
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ true: theme.colors.textPrimary }} thumbColor={theme.colors.switchThumb}
          style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
        />
      </View>
      {!isLast && <View style={styles.groupDivider} />}
    </>
  );
}

function NavRow({
  icon,
  label,
  value,
  onPress,
  isLast,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  isLast?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <>
      <Pressable
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={accessibilityLabel ?? (value ? `${label}, ${value}` : label)}
        accessibilityValue={value ? { text: value } : undefined}
        style={({ pressed }) => [styles.groupRow, pressed && onPress ? styles.groupRowPressed : null]}
        onPress={onPress}
      >
        <Ionicons name={icon} size={20} color={theme.colors.textPrimary} style={styles.groupRowIcon} />
        <View style={styles.groupRowContent}>
          <Text style={styles.groupRowLabel}>{label}</Text>
        </View>
        {value ? <Text style={styles.navRowValue}>{value}</Text> : null}
        <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
      </Pressable>
      {!isLast && <View style={styles.groupDivider} />}
    </>
  );
}

/* ── Main screen ───────────────────────────────────────────── */

export default function SettingsScreen() {
  const params = useLocalSearchParams<{ manageProvider?: string; chooseProvider?: string }>();
  const { user, loading: authLoading } = useAuth();
  // Start from the last loaded values: switching Appearance remounts this screen.
  const [profile, setProfile] = useState<UserProfile>(() => snapshotProfileFor(user?.uid));
  const [defaultPickup, setDefaultPickup] = useState(() => getSettingsSnapshot().defaultPickup);
  const [retentionDays, setRetentionDays] = useState(() => getSettingsSnapshot().retentionDays);
  const { scheme, setScheme } = useAppearance();
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(() => getSettingsSnapshot().notificationPrefs);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [developerNotionEnabled, setDeveloperNotionEnabled] = useState(true);
  const [notionCapability, setNotionCapability] = useState<NotionCapability | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [providerKeys, setProviderKeys] = useState<Record<AIProvider, boolean>>({ gemini: false, groq: false, claude: false });
  const [selectedProvider, setSelectedProvider] = useState<AIProvider | null>(null);
  const [aiSettingsLoading, setAISettingsLoading] = useState(true);
  const [aiSettingsLoadFailed, setAISettingsLoadFailed] = useState(false);
  const [serverFallbackProvider, setServerFallbackProvider] = useState<AIProvider | null>(null);
  const [providerSelectorVisible, setProviderSelectorVisible] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AIProvider | null>(null);
  const [draftProviderKey, setDraftProviderKey] = useState("");
  const [enteringProviderKey, setEnteringProviderKey] = useState(false);
  const { enabled: aiInsightsEnabled, setEnabled: setAIInsightsEnabled } = useAIInsightsSettings();

  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [draftProfile, setDraftProfile] = useState<UserProfile>(EMPTY_USER_PROFILE);
  const authProfileDefaults = useMemo(
    () => userProfileDefaultsFromAuth(user),
    [user?.displayName, user?.email]
  );
  const effectiveProfile = useMemo(
    () => withUserProfileDefaults(profile, authProfileDefaults),
    [authProfileDefaults, profile]
  );
  const effectiveNotion = useMemo(
    () => effectiveNotionCapability(notionCapability, developerNotionEnabled),
    [developerNotionEnabled, notionCapability],
  );
  const showNotionDeveloperUi = shouldShowNotionUi(__DEV__, notionCapability);

  useEffect(() => {
    updateSettingsSnapshot({ profile, profileOwner: user?.uid ?? null, defaultPickup, retentionDays, notificationPrefs });
  }, [profile, user?.uid, defaultPickup, retentionDays, notificationPrefs]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setAISettingsLoading(true);
      setAISettingsLoadFailed(false);

      const healthPromise = getHealth().catch((error) => {
        console.warn(`[AI] Backend health unavailable while loading Settings: ${String(error)}`);
        return null;
      });

      void (async () => {
        try {
          const [savedProfile, savedDefaults, savedRetentionDays, savedDeveloperNotionMode, health, savedNotificationPrefs] = await Promise.all([
            getUserProfile(user?.uid, authProfileDefaults),
            getListingDefaults(),
            getRecentlyDeletedRetentionDays(),
            __DEV__ ? getDeveloperNotionMode() : Promise.resolve(true),
            healthPromise,
            getNotificationPreferences(),
          ]);
          if (!active) return;
          setNotificationPrefs(savedNotificationPrefs);
          setProfile(savedProfile);
          setDefaultPickup(savedDefaults.defaultLocalPickup);
          setRetentionDays(savedRetentionDays);
          setDeveloperNotionEnabled(savedDeveloperNotionMode);
          setNotionCapability(notionCapabilityFromHealth(health));
        } catch (error) {
          console.warn(`[Settings] Preference load failed: ${String(error)}`);
        }
      })();

      void (async () => {
        try {
          const [health, geminiKey, groqKey, claudeKey, savedProvider] = await Promise.all([
            healthPromise,
            user?.uid ? getProviderApiKey(user.uid, "gemini") : Promise.resolve(null),
            user?.uid ? getProviderApiKey(user.uid, "groq") : Promise.resolve(null),
            user?.uid ? getProviderApiKey(user.uid, "claude") : Promise.resolve(null),
            getSelectedAIProvider(),
          ]);
          const backendProvider = isAIProvider(health?.ai_provider) ? health.ai_provider : null;
          const fallbackProvider = backendProvider && isServerAIKeyFallbackAvailable(health, backendProvider)
            ? backendProvider
            : null;
          console.log(
            `[AI] Settings loaded: savedProvider=${savedProvider ?? "none"}, backendProvider=${backendProvider ?? "none"}, geminiKeySaved=${Boolean(geminiKey?.trim())}, groqKeySaved=${Boolean(groqKey?.trim())}, claudeKeySaved=${Boolean(claudeKey?.trim())}, fallbackEnabled=${health?.allow_server_ai_key_fallback === true}, serverFallbackProvider=${fallbackProvider ?? "none"}, healthAvailable=${health !== null}, screenActive=${active}`,
          );
          if (!active) return;
          setProviderKeys({ gemini: Boolean(geminiKey?.trim()), groq: Boolean(groqKey?.trim()), claude: Boolean(claudeKey?.trim()) });
          setSelectedProvider(savedProvider);
          setServerFallbackProvider(fallbackProvider);
        } catch (error) {
          console.warn(`[AI] Settings load failed: ${String(error)}; screenActive=${active}`);
          if (active) setAISettingsLoadFailed(true);
        } finally {
          if (active) setAISettingsLoading(false);
        }
      })();
      return () => { active = false; };
    }, [authProfileDefaults, user?.uid])
  );

  useEffect(() => {
    const provider = params.manageProvider;
    if (!user || !isAIProvider(provider)) return;
    router.setParams({ manageProvider: undefined });
    void (async () => {
      const savedProvider = await getSelectedAIProvider();
      if (savedProvider !== provider) {
        setSelectedProvider(savedProvider);
        setProviderSelectorVisible(true);
        return;
      }
      const configured = Boolean((await getProviderApiKey(user.uid, provider))?.trim());
      setSelectedProvider(provider);
      setProviderKeys((current) => ({ ...current, [provider]: configured }));
      setEditingProvider(provider);
      setEnteringProviderKey(!configured);
      setDraftProviderKey("");
    })();
  }, [params.manageProvider, user]);

  useEffect(() => {
    if (params.chooseProvider !== "true") return;
    setProviderSelectorVisible(true);
    router.setParams({ chooseProvider: undefined });
  }, [params.chooseProvider]);

  // Auto-save toggles when they change
  const handlePhotoInsightsToggle = async (v: boolean) => {
    await setAIInsightsEnabled(v);
  };

  const handleSuggestedPricingToggle = () => {
    showNotImplemented("A separate Suggested Pricing setting");
  };

  const updateNotificationPrefs = async (next: NotificationPreferences) => {
    setNotificationPrefs(next);
    await saveNotificationPreferences(next);
  };

  const handleNotificationsToggle = async (enabled: boolean) => {
    if (!enabled) {
      await updateNotificationPrefs({ ...notificationPrefs, enabled: false });
      return;
    }
    const allowed = await requestNotificationPermission();
    if (allowed) {
      await updateNotificationPrefs({ ...notificationPrefs, enabled: true });
      return;
    }
    Alert.alert("Notifications are off for ListFlick", "Turn them on in iOS Settings to get listing alerts.", [
      { text: "Cancel", style: "cancel" },
      { text: "Open Settings", onPress: () => void Linking.openSettings() },
    ]);
  };

  const chooseAppearance = () => {
    Alert.alert("Appearance", undefined, [
      ...(["light", "dark"] as const).map((option) => ({
        text: `${colorSchemeLabel(option)}${option === scheme ? " ✓" : ""}`,
        onPress: () => {
          if (option !== scheme) void setScheme(option);
        },
      })),
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleDefaultPickupToggle = async (v: boolean) => {
    setDefaultPickup(v);
    await saveListingDefaults({ defaultLocalPickup: v });
  };

  const chooseRetentionDays = () => {
    Alert.alert("Recently Deleted Retention", "Automatically delete items after:", [
      ...([7, 30, 90] as const).map((days) => ({
        text: `${days} days${days === retentionDays ? " ✓" : ""}`,
        onPress: async () => {
          setRetentionDays(days);
          await saveRecentlyDeletedRetentionDays(days);
        },
      })),
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleDeveloperNotionToggle = async (enabled: boolean) => {
    if (!effectiveNotion.canOverride) return;
    setDeveloperNotionEnabled(enabled);
    await saveDeveloperNotionMode(enabled);
  };

  const closeProviderKeyManager = () => {
    setEditingProvider(null);
    setDraftProviderKey("");
    setEnteringProviderKey(false);
  };

  const openProviderKeyManager = (provider: AIProvider) => {
    if (!user) {
      Alert.alert("Sign In Required", "Sign in to configure an AI provider key.");
      return;
    }
    setEditingProvider(provider);
    setDraftProviderKey("");
    setEnteringProviderKey(!providerKeys[provider]);
  };

  const saveProviderKey = async () => {
    if (!user || !editingProvider) return;
    try {
      await setProviderApiKey(user.uid, editingProvider, draftProviderKey);
      setProviderKeys((current) => ({ ...current, [editingProvider]: true }));
      closeProviderKeyManager();
      Alert.alert(
        "API key saved",
        "The key is saved on this device. It will be checked by the provider the next time you use AI.",
      );
    } catch (error: any) {
      Alert.alert("Could not save key", error?.message || "Enter a provider API key.");
    }
  };

  const confirmRemoveProviderKey = (provider: AIProvider) => {
    if (!user) return;
    const label = providerDisplayName(provider);
    Alert.alert(`Remove ${label} API Key?`, `This removes the ${label} key stored on this device.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove Key",
        style: "destructive",
        onPress: () => {
          void (async () => {
            await deleteProviderApiKey(user.uid, provider);
            setProviderKeys((current) => ({ ...current, [provider]: false }));
            closeProviderKeyManager();
          })();
        },
      },
    ]);
  };

  const chooseProvider = async (provider: AIProvider) => {
    const isFirstSelection = selectedProvider === null;
    setSelectedProvider(provider);
    setProviderSelectorVisible(false);
    await saveSelectedAIProvider(provider);
    if (isFirstSelection && !providerKeys[provider]) {
      const health = await getHealth().catch(() => null);
      if (!isServerAIKeyFallbackAvailable(health, provider)) {
        setEditingProvider(provider);
        setEnteringProviderKey(true);
        setDraftProviderKey("");
      }
    }
  };

  const handleSignOut = async () => {
    const auth = getAuth(getApp());
    authDebugLog("sign-out requested", describeAuthUser(auth.currentUser));
    try {
      await signOut(auth);
      authDebugLog("sign-out completed", describeAuthUser(auth.currentUser));
    } catch (error: any) {
      authDebugWarn("sign-out failed", { code: error?.code, message: error?.message });
      Alert.alert("Sign Out Failed", error?.message || "Could not sign out");
    }
  };

  const copySupportText = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert("Copied", `${label} copied to the clipboard.`);
  };

  const showSupportFallback = (supportBody: string) => {
    Alert.alert(
      "Email app unavailable",
      `Email ${SUPPORT_EMAIL}, or copy the diagnostic template and paste it into your preferred email app.`,
      [
        {
          text: "Copy Email",
          onPress: () => void copySupportText(SUPPORT_EMAIL, "Support email"),
        },
        {
          text: "Copy Template",
          onPress: () => void copySupportText(supportBody, "Support template"),
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  };

  const handleContactSupport = async () => {
    const supportBody = buildSupportEmailBody(APP_VERSION, Platform.OS);
    const mailtoUrl = buildSupportMailtoUrl(APP_VERSION, Platform.OS);
    try {
      if (await Linking.canOpenURL(mailtoUrl)) {
        await Linking.openURL(mailtoUrl);
        return;
      }
    } catch {
      // The same copy fallback covers missing handlers and launch failures.
    }
    showSupportFallback(supportBody);
  };

  const handleDeleteAccount = async () => {
    if (!user || deletingAccount) return;
    const uid = user.uid;
    setDeletingAccount(true);
    try {
      await deleteAccount();
      await clearLocalUserData(uid);
      await signOut(getAuth(getApp()));
      Alert.alert("Account Deleted", "Your account, listings, images, and local listing data were deleted.");
    } catch (error: any) {
      authDebugWarn("account deletion failed", { code: error?.code, message: error?.message });
      // Status 502 means the server already deleted the account's data and only
      // the final Firebase auth step failed, so the local session is stale and
      // must be cleared even though the overall request reported failure.
      if (error instanceof ApiError && error.status === 502) {
        try {
          await clearLocalUserData(uid);
          await signOut(getAuth(getApp()));
        } catch (cleanupError: any) {
          authDebugWarn("post-failure local cleanup failed", {
            code: cleanupError?.code,
            message: cleanupError?.message,
          });
        }
        Alert.alert(
          "Account Deletion Incomplete",
          "Your account data was deleted, but we couldn't finish removing your sign-in. You've been signed out locally; contact support if you still see a signed-in account."
        );
      } else {
        Alert.alert("Account Deletion Failed", error?.message || "Could not delete your account. Please try again.");
      }
    } finally {
      setDeletingAccount(false);
    }
  };

  const signedInEmail = authProfileDefaults.username?.trim() ?? "";
  const profileComplete = isUserProfileComplete(effectiveProfile);
  const displayName = effectiveProfile.name || (user ? "Complete your profile" : "Signed out");
  const displayEmail = signedInEmail || effectiveProfile.username || "Sign in to save and sync your listings";
  const profileHint = authLoading
    ? "Checking sign-in status"
    : user
      ? profileComplete
        ? "Profile complete"
        : "Tap to complete seller details"
      : "Tap to sign in";
  const aiPresentation = aiSettingsPresentation(
    selectedProvider,
    selectedProvider ? providerKeys[selectedProvider] : false,
  );
  const aiProviderValue = aiSettingsLoading ? "Loading…" : aiPresentation.providerLabel;
  const aiSettingsHint = aiSettingsLoadFailed
    ? "AI settings could not be loaded. Leave and reopen Settings to try again."
    : !selectedProvider && serverFallbackProvider
      ? `No override saved. This deployment currently supplies ${providerDisplayName(serverFallbackProvider)}.`
      : "Choose the AI service ListFlick uses.";

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Settings</Text>
          <Text style={styles.headerSubtitle}>Manage your account and preferences</Text>
        </View>

        {/* Profile Card */}
        <Pressable
          style={styles.profileCard}
          accessibilityRole="button"
          onPress={() => {
            if (!user) {
              router.replace("/(auth)/login");
              return;
            }
            setDraftProfile(effectiveProfile);
            setEditProfileVisible(true);
          }}
        >
          <View style={styles.avatarPlaceholder}>
            <Ionicons name="person" size={24} color={theme.colors.textTertiary} />
          </View>
          <View style={styles.profileText}>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, user ? styles.statusDotSignedIn : styles.statusDotSignedOut]} />
              <Text style={styles.statusText}>{user ? "Signed in" : "Signed out"}</Text>
            </View>
            <Text style={styles.profileName}>{displayName}</Text>
            <Text style={styles.profileEmail}>{displayEmail}</Text>
            <Text style={styles.profileHint}>{profileHint}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} />
        </Pressable>

        {/* LISTING DEFAULTS */}
        <Text style={styles.sectionLabel}>LISTING DEFAULTS</Text>
        <View style={styles.groupCard}>
          <ToggleRow
            icon="sparkles-outline"
            label="AI Photo Insights"
            subtitle="Feedback on each photo"
            value={aiInsightsEnabled}
            onValueChange={handlePhotoInsightsToggle}
          />
          <ToggleRow
            icon="pricetag-outline"
            label="Suggested Pricing"
            subtitle="Auto-fill recommended price"
            value={false}
            onValueChange={handleSuggestedPricingToggle}
          />
          <ToggleRow
            icon="location-outline"
            label="Default to Local Pickup"
            value={defaultPickup}
            onValueChange={handleDefaultPickupToggle}
            isLast
          />
        </View>

        {/* PREFERENCES */}
        <Text style={styles.sectionLabel}>PREFERENCES</Text>
        <View style={styles.groupCard}>
          <NavRow
            icon="notifications-outline"
            label="Notifications"
            value={notificationsLabel(notificationPrefs)}
            onPress={() => setNotificationsVisible(true)}
          />
          <NavRow icon="logo-usd" label="Currency" value="USD" onPress={() => Alert.alert(CURRENCY_TITLE, CURRENCY_MESSAGE)} />
          <NavRow icon="trash-outline" label="Recently Deleted" value={`${retentionDays} days`} onPress={chooseRetentionDays} />
          <NavRow icon="moon-outline" label="Appearance" value={colorSchemeLabel(scheme)} onPress={chooseAppearance} isLast />
        </View>

        {/* AI */}
        <Text style={styles.sectionLabel}>AI</Text>
        <Text style={styles.sectionHint}>{aiSettingsHint}</Text>
        <View style={styles.groupCard}>
          <NavRow
            icon="sparkles-outline"
            label="AI Provider"
            value={aiProviderValue}
            onPress={aiSettingsLoading ? undefined : () => setProviderSelectorVisible(true)}
            isLast={aiSettingsLoading || !selectedProvider}
          />
          {!aiSettingsLoading && selectedProvider && aiPresentation.credentialLabel && aiPresentation.credentialStatus ? (
            <NavRow
              icon="key-outline"
              label={aiPresentation.credentialLabel}
              value={aiPresentation.credentialStatus}
              accessibilityLabel={`${aiPresentation.credentialLabel}, ${aiPresentation.credentialStatus}`}
              onPress={() => openProviderKeyManager(selectedProvider)}
              isLast
            />
          ) : null}
        </View>

        {showNotionDeveloperUi && (
          <>
            <Text style={styles.sectionLabel}>DEVELOPER</Text>
            <View style={styles.groupCard}>
              <ToggleRow
                icon="cloud-outline"
                label="Notion Request Override"
                subtitle={notionCapabilitySubtitle(effectiveNotion)}
                value={effectiveNotion.effectiveRequestEnabled}
                onValueChange={handleDeveloperNotionToggle}
                disabled={!effectiveNotion.canOverride}
                isLast
              />
            </View>
          </>
        )}

        {/* SUPPORT */}
        <Text style={styles.sectionLabel}>SUPPORT</Text>
        <View style={styles.groupCard}>
          <NavRow icon="help-circle-outline" label="Contact Support" onPress={() => void handleContactSupport()} />
          <NavRow icon="shield-checkmark-outline" label="Privacy & Data" onPress={() => router.push("/privacy-policy")} />
          <NavRow icon="document-text-outline" label="Terms of Service" onPress={() => router.push("/terms-of-use")} isLast />
        </View>

        {authLoading ? (
          <View style={styles.authLoadingRow}>
            <ActivityIndicator color={theme.colors.textSecondary} />
            <Text style={styles.authLoadingText}>Checking sign-in status…</Text>
          </View>
        ) : user ? (
          <>
            <Pressable
              style={styles.signOutButton}
              accessibilityRole="button"
              onPress={() => Alert.alert("Sign Out", "Are you sure you want to sign out?", [
                { text: "Cancel", style: "cancel" },
                { text: "Sign Out", style: "destructive", onPress: handleSignOut },
              ])}
            >
              <Ionicons name="log-out-outline" size={18} color="#E53E3E" />
              <Text style={styles.signOutText}>Sign Out</Text>
            </Pressable>
            <Pressable
              style={styles.deleteAccountButton}
              accessibilityRole="button"
              disabled={deletingAccount}
              onPress={() => Alert.alert(
                "Delete Account",
                "This permanently deletes your account, listings, uploaded images, and local listing data. This cannot be undone. Copies already synced to Notion must be deleted there.",
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete Account", style: "destructive", onPress: () => void handleDeleteAccount() },
                ]
              )}
            >
              {deletingAccount ? <ActivityIndicator color="#B91C1C" /> : <Ionicons name="trash-outline" size={18} color="#B91C1C" />}
              <Text style={styles.deleteAccountText}>{deletingAccount ? "Deleting Account…" : "Delete Account"}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            style={styles.signInButton}
            accessibilityRole="button"
            onPress={() => router.replace("/(auth)/login")}
          >
            <Ionicons name="log-in-outline" size={18} color={theme.colors.background} />
            <Text style={styles.signInText}>Sign In</Text>
          </Pressable>
        )}

        {/* Version */}
        <Text style={styles.versionText}>Version {APP_VERSION}</Text>
      </ScrollView>

      <Modal
        visible={notificationsVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setNotificationsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Notifications</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close notification settings" onPress={() => setNotificationsVisible(false)}>
                <Ionicons name="close" size={24} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
            <View style={styles.selectorCard}>
              <ToggleRow
                icon="notifications-outline"
                label="Allow Notifications"
                subtitle="Alerts while ListFlick is in the background"
                value={notificationPrefs.enabled}
                onValueChange={(v) => void handleNotificationsToggle(v)}
              />
              <ToggleRow
                icon="checkmark-circle-outline"
                label="Listing Ready"
                subtitle="When a listing finishes writing"
                value={notificationPrefs.enabled && notificationPrefs.listingReady}
                onValueChange={(v) => void updateNotificationPrefs({ ...notificationPrefs, listingReady: v })}
                disabled={!notificationPrefs.enabled}
              />
              <ToggleRow
                icon="alert-circle-outline"
                label="Needs Attention"
                subtitle="When a listing fails or is missing details"
                value={notificationPrefs.enabled && notificationPrefs.needsAttention}
                onValueChange={(v) => void updateNotificationPrefs({ ...notificationPrefs, needsAttention: v })}
                disabled={!notificationPrefs.enabled}
                isLast
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={providerSelectorVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setProviderSelectorVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose AI Provider</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close provider selector" onPress={() => setProviderSelectorVisible(false)}>
                <Ionicons name="close" size={24} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
            <View style={styles.selectorCard}>
              {AI_PROVIDERS.map((provider, index) => {
                const selected = selectedProvider === provider;
                const label = providerDisplayName(provider);
                return (
                  <View key={provider}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      accessibilityState={{ selected }}
                      style={({ pressed }) => [styles.selectorRow, pressed && styles.groupRowPressed]}
                      onPress={() => void chooseProvider(provider)}
                    >
                      <Text style={styles.selectorLabel}>{label}</Text>
                      {selected ? <Ionicons name="checkmark" size={22} color={theme.colors.accent} /> : null}
                    </Pressable>
                    {index < AI_PROVIDERS.length - 1 ? <View style={styles.selectorDivider} /> : null}
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={editingProvider !== null} animationType="slide" transparent onRequestClose={closeProviderKeyManager}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingProvider ? providerDisplayName(editingProvider) : "AI"} API Key</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close API key settings" onPress={closeProviderKeyManager}>
                <Ionicons name="close" size={24} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
            {editingProvider && enteringProviderKey ? (
              <>
                <Text style={styles.modalHint}>
                  Your key is stored securely on this device and sent to ListFlick only when {providerDisplayName(editingProvider)} processes a request. It is checked by the provider the next time you use AI.
                </Text>
                <TextInput
                  accessibilityLabel={`${providerDisplayName(editingProvider)} API key`}
                  style={styles.input}
                  value={draftProviderKey}
                  onChangeText={setDraftProviderKey}
                  placeholder="Paste API key"
                  placeholderTextColor={theme.colors.textTertiary}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <View style={styles.modalFooter}>
                  <Pressable style={styles.saveButton} accessibilityRole="button" accessibilityLabel="Save API key" onPress={() => void saveProviderKey()}>
                    <Text style={styles.saveButtonText}>Save Key</Text>
                  </Pressable>
                </View>
              </>
            ) : editingProvider ? (
              <>
                <View accessibilityLabel={`${providerDisplayName(editingProvider)} API key, saved on this device`} style={styles.configuredState}>
                  <Ionicons name="checkmark-circle" size={22} color={theme.colors.accent} />
                  <Text style={styles.configuredStateText}>Saved on this device</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Replace ${providerDisplayName(editingProvider)} API key`}
                  style={styles.managementButton}
                  onPress={() => setEnteringProviderKey(true)}
                >
                  <Text style={styles.managementButtonText}>Replace Key</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${providerDisplayName(editingProvider)} API key`}
                  style={styles.removeKeyButton}
                  onPress={() => confirmRemoveProviderKey(editingProvider)}
                >
                  <Text style={styles.removeKeyButtonText}>Remove Key</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Profile Modal */}
      <Modal visible={editProfileVisible} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile</Text>
              <Pressable accessibilityRole="button" onPress={() => setEditProfileVisible(false)}>
                <Ionicons name="close" size={24} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.modalScroll}>
              <Text style={styles.inputLabel}>Display Name</Text>
              <TextInput
                style={styles.input}
                value={draftProfile.name}
                onChangeText={(t) => setDraftProfile({ ...draftProfile, name: t })}
                placeholder="Your Name"
                placeholderTextColor={theme.colors.textTertiary}
              />

              <Text style={styles.inputLabel}>Account Email</Text>
              <View style={styles.readOnlyInput}>
                <Text style={styles.readOnlyInputText}>{signedInEmail || "No email provided by sign-in provider"}</Text>
                <Text style={styles.readOnlyInputHint}>Managed by your sign-in provider</Text>
              </View>

              <Text style={styles.inputLabel}>Preferred Pickup Location</Text>
              <TextInput
                style={styles.input}
                value={draftProfile.pickupLocation}
                onChangeText={(t) => setDraftProfile({ ...draftProfile, pickupLocation: t })}
                placeholder="e.g. Near Downtown Starbucks"
                placeholderTextColor={theme.colors.textTertiary}
              />

              <Text style={styles.inputLabel}>Accepted Payment Methods</Text>
              <TextInput
                style={styles.input}
                value={draftProfile.paymentMethods}
                onChangeText={(t) => setDraftProfile({ ...draftProfile, paymentMethods: t })}
                placeholder="e.g. Cash, Venmo, Zelle"
                placeholderTextColor={theme.colors.textTertiary}
              />
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable
                style={styles.saveButton}
                accessibilityRole="button"
                onPress={async () => {
                  const profileToSave = withUserProfileDefaults(
                    { ...draftProfile, username: signedInEmail || draftProfile.username },
                    authProfileDefaults
                  );
                  setProfile(profileToSave);
                  await saveUserProfile(profileToSave, user?.uid);
                  setEditProfileVisible(false);
                }}
              >
                <Text style={styles.saveButtonText}>Save Changes</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/* ── Styles ────────────────────────────────────────────────── */

const styles = themedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing.screenPadding,
    paddingBottom: 16,
  },

  /* Header */
  header: {
    paddingTop: 64,
    paddingBottom: 24,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: theme.colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 15,
    color: theme.colors.textSecondary,
    marginTop: 4,
  },

  /* Profile card */
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    padding: 16,
    marginBottom: 28,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  profileText: {
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  profileEmail: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  profileHint: {
    fontSize: 12,
    color: theme.colors.textTertiary,
    marginTop: 4,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusDotSignedIn: {
    backgroundColor: "#22C55E",
  },
  statusDotSignedOut: {
    backgroundColor: "#E53E3E",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.textSecondary,
  },

  /* Section labels */
  sectionLabel: {
    ...theme.typography.sectionLabel,
    color: theme.colors.textSecondary,
    marginBottom: 10,
  },
  sectionHint: {
    fontSize: 12,
    lineHeight: 17,
    color: theme.colors.textSecondary,
    marginTop: -4,
    marginBottom: 10,
  },

  /* Grouped cards */
  groupCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    overflow: "hidden",
    marginBottom: 28,
  },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 52,
  },
  groupRowPressed: {
    opacity: 0.65,
  },
  groupRowIcon: {
    width: 28,
    textAlign: "center",
    marginRight: 14,
  },
  groupRowContent: {
    flex: 1,
  },
  groupRowLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
  groupRowSub: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  groupDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: 58, // icon width + margin
  },
  navRowValue: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginRight: 6,
  },
  /* Sign Out */
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    marginBottom: 16,
  },
  signOutText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#E53E3E",
  },
  deleteAccountButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    marginBottom: 16,
  },
  deleteAccountText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#B91C1C",
  },
  signInButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.button,
    paddingVertical: 14,
    marginBottom: 16,
  },
  signInText: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.background,
  },
  authLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    marginBottom: 16,
  },
  authLoadingText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },

  /* Version */
  versionText: {
    textAlign: "center",
    fontSize: 13,
    color: theme.colors.textTertiary,
    marginBottom: 0,
  },

  /* Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 16,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.textPrimary,
  },
  modalHint: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
    marginBottom: 14,
  },
  selectorCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    overflow: "hidden",
  },
  selectorRow: {
    minHeight: 54,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectorLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
  selectorDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: 16,
  },
  configuredState: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.button,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  configuredStateText: {
    fontSize: 15,
    color: theme.colors.textPrimary,
    fontWeight: "500",
  },
  managementButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.button,
    marginBottom: 10,
  },
  managementButtonText: {
    color: theme.colors.background,
    fontSize: 15,
    fontWeight: "700",
  },
  removeKeyButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  removeKeyButtonText: {
    color: "#B91C1C",
    fontSize: 15,
    fontWeight: "600",
  },
  modalScroll: {
    marginBottom: 20,
  },
  inputLabel: {
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
  readOnlyInput: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.button,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  readOnlyInputText: {
    fontSize: 16,
    color: theme.colors.textPrimary,
  },
  readOnlyInputHint: {
    fontSize: 12,
    color: theme.colors.textTertiary,
    marginTop: 4,
  },
  modalFooter: {
    marginTop: 10,
  },
  saveButton: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.button,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveButtonText: {
    color: theme.colors.background,
    fontSize: 16,
    fontWeight: "600",
  },
}));
