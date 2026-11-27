import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { E2E_RESET_AI_SETTINGS } from "../constants/config";
import { theme, themedStyles } from "../constants/theme";
import { clearProviderApiKeys } from "../services/aiCredentials";
import { clearSelectedAIProvider } from "../services/storage";
import { AIInsightsProvider } from "../state/AIInsightsContext";
import { ListingWorkspaceProvider } from "../state/ListingWorkspaceContext";
import { AuthProvider, useAuth } from "../state/AuthContext";
import { AppearanceProvider, useAppearance } from "../state/AppearanceContext";
import { configureNotificationHandler } from "../services/notifications";
import { authDebugLog } from "../utils/authDebug";

configureNotificationHandler();

function RootLayoutNav() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const didReportUsableScreen = useRef(false);
  const { scheme } = useAppearance();
  const statusBarStyle = scheme === "dark" ? "light" : "dark";

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === "(auth)";
    authDebugLog("route guard evaluated", {
      loading,
      signedIn: Boolean(user),
      route: segments.join("/"),
      inAuthGroup,
    });

    if (!user && !inAuthGroup) {
      // Redirect to the login page.
      authDebugLog("redirecting signed-out user to login", { route: segments.join("/") });
      router.replace("/(auth)/login");
    } else if (user && inAuthGroup) {
      // Redirect away from the login page.
      authDebugLog("redirecting signed-in user to app", { route: segments.join("/") });
      router.replace("/(tabs)");
    }
  }, [user, loading, segments]);

  const inAuthGroup = segments[0] === "(auth)";
  const isRedirecting = !loading && ((!user && !inAuthGroup) || (user && inAuthGroup));

  useEffect(() => {
    if (loading || isRedirecting || didReportUsableScreen.current) return;

    let secondFrame: number | undefined;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        didReportUsableScreen.current = true;
        if (__DEV__) console.info("[AppStartup] first_usable_screen");
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
    };
  }, [isRedirecting, loading]);

  if (loading || isRedirecting) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style={statusBarStyle} />
        <ActivityIndicator color={theme.colors.textPrimary} />
      </View>
    );
  }

  return (
    <AIInsightsProvider>
      <ListingWorkspaceProvider>
        <StatusBar style={statusBarStyle} />
        {/* Keyed by scheme so every screen redraws with the new palette */}
        <Stack
          key={scheme}
          screenOptions={{
            headerStyle: { backgroundColor: theme.colors.background },
            headerTintColor: theme.colors.textPrimary,
            headerTitleStyle: theme.typography.screenTitle,
            contentStyle: { backgroundColor: theme.colors.background },
            headerShadowVisible: false, // clean look
          }}
        >
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="camera" options={{ headerShown: false }} />
          <Stack.Screen name="processing" options={{ title: "Analyzing", headerBackVisible: false, headerShown: false }} />
          <Stack.Screen name="review" options={{ headerShown: false }} />
          <Stack.Screen name="edit-listing" options={{ headerShown: false }} />
          <Stack.Screen name="manage-photos" options={{ headerShown: false }} />
          <Stack.Screen name="recently-deleted" options={{ headerShown: false }} />
          <Stack.Screen name="privacy-policy" options={{ headerShown: false }} />
          <Stack.Screen name="terms-of-use" options={{ headerShown: false }} />
        </Stack>
      </ListingWorkspaceProvider>
    </AIInsightsProvider>
  );
}

function RootLayoutBootstrap() {
  const { user, loading } = useAuth();
  const [preparedUid, setPreparedUid] = useState<string | null>(null);
  const [resetFailed, setResetFailed] = useState(false);
  const { scheme } = useAppearance();

  useEffect(() => {
    if (!E2E_RESET_AI_SETTINGS || loading || !user || preparedUid === user.uid) return;

    let active = true;
    setResetFailed(false);
    void Promise.all([clearSelectedAIProvider(), clearProviderApiKeys(user.uid)])
      .then(() => {
        if (active) setPreparedUid(user.uid);
      })
      .catch((error) => {
        console.error(`[E2E] AI settings reset failed: ${String(error)}`);
        if (active) setResetFailed(true);
      });
    return () => {
      active = false;
    };
  }, [loading, preparedUid, user]);

  const ready = !E2E_RESET_AI_SETTINGS || (!loading && !user) || preparedUid === user?.uid;
  if (!ready) {
    return (
      <View style={styles.loadingContainer} testID={resetFailed ? "e2e-ai-reset-failed" : "e2e-ai-reset-pending"}>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        {resetFailed ? (
          <Text style={{ color: theme.colors.textPrimary }}>Could not reset the local E2E AI settings.</Text>
        ) : (
          <ActivityIndicator color={theme.colors.textPrimary} />
        )}
      </View>
    );
  }

  return <RootLayoutNav />;
}

export default function RootLayout() {
  return (
    <AppearanceProvider>
      <AuthProvider>
        <RootLayoutBootstrap />
      </AuthProvider>
    </AppearanceProvider>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
}));
