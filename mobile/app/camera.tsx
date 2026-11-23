import { CameraType, CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getAuthUser } from "../services/authSession";
import { theme } from "../constants/theme";
import { CameraPreview } from "../components/camera/CameraPreview";
import { PhotoManager } from "../components/camera/PhotoManager";
import { getHealth } from "../services/api";
import { hasProviderApiKey } from "../services/aiCredentials";
import {
  getPendingAnalysisOperation,
  getEffectiveAIProvider,
  getSelectedAIProvider,
  savePendingAnalysisOperation,
} from "../services/storage";
import { createPendingAnalysisOperation } from "../utils/pendingAnalysis";
import {
  deletePendingAnalysisImages,
  persistPendingAnalysisImages,
} from "../utils/pendingAnalysisFiles";
import { showAIKeyRequiredPrompt, showAIProviderRequiredPrompt } from "../utils/aiCredentialPrompt";
import { isServerAIKeyFallbackAvailable } from "../utils/aiProviderAvailability";

export default function CameraScreen() {
  const params = useLocalSearchParams<{ openPicker?: string }>();
  const cameraRef = useRef<CameraView>(null);
  const openedPickerFromParam = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [facing, setFacing] = useState<CameraType>("back");
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [sharingToLens, setSharingToLens] = useState(false);
  const [scanningMode, setScanningMode] = useState(false);
  const scanAnim = useRef(new Animated.Value(0)).current;
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [startingProcessing, setStartingProcessing] = useState(false);
  const aiPreflightPassed = useRef(false);

  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      // Provider/key settings may have changed while this tab was unfocused.
      aiPreflightPassed.current = false;
    }, []),
  );

  /* ── Actions ───────────────────────────────────────────── */

  const ensureAIProviderReady = useCallback(async (): Promise<boolean> => {
    if (aiPreflightPassed.current) return true;

    const currentUser = getAuthUser();
    if (!currentUser) {
      Alert.alert("Sign In Required", "Sign in before starting an AI listing.");
      return false;
    }

    const health = await getHealth().catch(() => null);
    const savedProvider = await getSelectedAIProvider();
    const provider = await getEffectiveAIProvider(health);
    const backendProvider = health?.ai_provider === "gemini" || health?.ai_provider === "groq"
      ? health.ai_provider
      : "none";
    const fallbackEnabled = health?.allow_server_ai_key_fallback === true;
    const providerServerKeyConfigured = provider === "gemini"
      ? Boolean(health?.gemini_configured)
      : provider === "groq"
        ? Boolean(health?.groq_configured)
        : false;
    const fallbackAvailable = provider
      ? isServerAIKeyFallbackAvailable(health, provider)
      : false;
    const hasDeviceKey = provider
      ? await hasProviderApiKey(currentUser.uid, provider)
      : false;
    console.log(
      `[AI] Camera pre-flight: aiMode=${health?.ai_mode ?? "unknown"}, savedProvider=${savedProvider ?? "none"}, backendProvider=${backendProvider}, effectiveProvider=${provider ?? "none"}, deviceKey=${hasDeviceKey}, fallbackEnabled=${fallbackEnabled}, providerServerKeyConfigured=${providerServerKeyConfigured}, serverFallbackAvailable=${fallbackAvailable}, healthAvailable=${health !== null}`,
    );
    if (!provider) {
      showAIProviderRequiredPrompt();
      return false;
    }
    if (hasDeviceKey || fallbackAvailable) {
      aiPreflightPassed.current = true;
      return true;
    }

    showAIKeyRequiredPrompt(provider, `Add your ${provider === "gemini" ? "Gemini" : "Groq"} API key before taking listing photos.`);
    return false;
  }, []);

  const goToProcessing = async (uris: string[]) => {
    if (startingProcessing) return;
    if (!(await ensureAIProviderReady())) return;
    setStartingProcessing(true);
    let operationId: string | undefined;
    try {
      const pending = await getPendingAnalysisOperation();
      if (pending) {
        Alert.alert(
          "Listing already in progress",
          "Resume or discard the current listing before starting another.",
          [
            { text: "Keep Editing", style: "cancel" },
            {
              text: "Resume",
              onPress: () => router.replace({
                pathname: "/processing",
                params: { operationId: pending.operationId },
              }),
            },
          ]
        );
        setStartingProcessing(false);
        return;
      }
      const operation = createPendingAnalysisOperation(uris);
      operationId = operation.operationId;
      const durableImageUris = await persistPendingAnalysisImages(operation.operationId, uris);
      await savePendingAnalysisOperation({
        ...operation,
        imageUris: durableImageUris,
      });
      router.push({
        pathname: "/processing",
        params: { operationId: operation.operationId },
      });
    } catch {
      if (operationId) await deletePendingAnalysisImages(operationId);
      Alert.alert("Could not start", "The listing could not be saved for recovery. Please try again.");
      setStartingProcessing(false);
    }
  };

  const takePhoto = async () => {
    if (!cameraRef.current || capturing) return;
    if (!(await ensureAIProviderReady())) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (photo?.uri) setImageUris((current) => [...current, photo.uri].slice(0, 8));
    } catch {
      Alert.alert("Error", "Could not capture photo. Please try again.");
    } finally {
      setCapturing(false);
    }
  };

  const pickFromGallery = useCallback(async () => {
    if (!(await ensureAIProviderReady())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, 8 - imageUris.length),
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setImageUris((current) => [...current, ...result.assets.map((asset) => asset.uri)].slice(0, 8));
    }
  }, [ensureAIProviderReady, imageUris.length]);

  useEffect(() => {
    if (params.openPicker !== "true" || openedPickerFromParam.current) return;
    openedPickerFromParam.current = true;
    void pickFromGallery();
  }, [params.openPicker, pickFromGallery]);

  /* ── Permission states ─────────────────────────────────── */

  if (!permission && imageUris.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.textPrimary} />
      </View>
    );
  }

  if (!permission?.granted && imageUris.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="camera-outline" size={48} color={theme.colors.textTertiary} style={{ marginBottom: 16 }} />
        <Text style={styles.permMessage}>Camera access is required to photograph items.</Text>
        <Pressable style={styles.permButton} onPress={requestPermission}>
          <Text style={styles.permButtonText}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  const removeImage = (uri: string) => {
    setImageUris((current) => current.filter((item) => item !== uri));
  };

  const toggleFlash = () => setFlashEnabled((v) => !v);
  const toggleFacing = () => setFacing((f) => (f === "back" ? "front" : "back"));


  const handleSmartScan = () => {
    if (imageUris.length === 0 || sharingToLens || scanningMode) return;
    setScanningMode(true);

    Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(scanAnim, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    ).start();

    setTimeout(() => {
      scanAnim.stopAnimation();
      setScanningMode(false);
      searchWithLens();
    }, 2000);
  };

  const searchWithLens = async () => {
    const firstImageUri = imageUris[0];
    if (!firstImageUri || sharingToLens) return;
    setSharingToLens(true);
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert(
          "Sharing Unavailable",
          "Open Google Lens or Google manually and choose this photo from your camera roll."
        );
        return;
      }
      await Sharing.shareAsync(firstImageUri, {
        dialogTitle: "Search this item",
        mimeType: "image/jpeg",
        UTI: "public.jpeg",
      });
    } catch {
      Alert.alert(
        "Could Not Open Search",
        "Your selected photos are still here. You can try again or tap Next to continue."
      );
    } finally {
      setSharingToLens(false);
    }
  };

  /* ── Render ────────────────────────────────────────────── */

  return (
    <View style={styles.container} testID="camera-screen">
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 20) + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.topBarButton}>
          <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <View style={styles.topBarRight}>
          {/* Flash */}
          <Pressable onPress={toggleFlash} style={styles.topBarIcon}>
            <Ionicons
              name={flashEnabled ? "flash" : "flash-off"}
              size={20}
              color={theme.colors.textPrimary}
            />
          </Pressable>
          {/* Google Lens Smart Scan */}
          <Pressable
            style={[styles.topBarIcon, imageUris.length === 0 && { opacity: 0.5 }]}
            onPress={handleSmartScan}
            disabled={imageUris.length === 0 || sharingToLens || scanningMode}
          >
            {sharingToLens || scanningMode ? (
              <ActivityIndicator size="small" color={theme.colors.textPrimary} />
            ) : (
              <Ionicons name="sparkles" size={20} color={theme.colors.textPrimary} />
            )}
          </Pressable>
          {/* Next Button */}
          <Pressable
            onPress={() => void goToProcessing(imageUris)}
            testID="camera-next"
            accessibilityLabel="Analyze selected photos"
            style={[styles.topBarButton, { marginLeft: 12 }, (imageUris.length === 0 || startingProcessing) && { opacity: 0.5 }]}
            disabled={imageUris.length === 0 || startingProcessing}
          >
            {startingProcessing ? (
              <ActivityIndicator size="small" color={theme.colors.textPrimary} />
            ) : (
              <>
                <Text style={styles.cancelText}>Next</Text>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.textPrimary} />
              </>
            )}
          </Pressable>
        </View>
      </View>

      {/* Camera viewfinder */}
      <CameraPreview
        ref={cameraRef}
        hasPermission={!!permission?.granted}
        facing={facing}
        flashEnabled={flashEnabled}
        scanningMode={scanningMode}
        scanAnim={scanAnim}
      />

      {/* AI hint banner
      <View style={styles.hintBanner}>
        <Ionicons name="sparkles" size={16} color={theme.colors.background} />
        <Text style={styles.hintText}>Capture your item from multiple angles.</Text>
      </View> */}

      {/* Photo tray */}
      <PhotoManager
        imageUris={imageUris}
        onRemoveImage={removeImage}
        onAddImage={pickFromGallery}
        onPreviewImage={setPreviewImage}
      />

      {/* Bottom controls */}
      <View style={styles.controls}>
        {/* Library */}
        <Pressable
          style={styles.sideAction}
          onPress={pickFromGallery}
          testID="camera-open-library"
          accessibilityLabel="Choose more photos from library"
        >
          <View style={styles.sideIconBox}>
            <Ionicons name="images-outline" size={22} color={theme.colors.textPrimary} />
          </View>
          <Text style={styles.sideLabel}>Library</Text>
        </Pressable>

        {/* Capture Area */}
        <View style={{ alignItems: "center", justifyContent: "center", zIndex: 10 }}>
          <Pressable
            style={[styles.captureButton, (capturing || imageUris.length >= 8) && styles.captureDisabled]}
            onPress={takePhoto}
            disabled={capturing || imageUris.length >= 8}
          >
            {capturing ? (
              <ActivityIndicator color={theme.colors.textPrimary} />
            ) : (
              <View style={styles.captureInner} />
            )}
          </Pressable>
        </View>

        {/* Flip */}
        <Pressable style={styles.sideAction} onPress={toggleFacing}>
          <View style={styles.sideIconBox}>
            <Ionicons name="camera-reverse-outline" size={22} color={theme.colors.textPrimary} />
          </View>
          <Text style={styles.sideLabel}>Flip</Text>
        </Pressable>
      </View>

      {/* Preview Modal */}
      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' }} onPress={() => setPreviewImage(null)}>
          {previewImage && (
            <Image source={{ uri: previewImage }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />
          )}
        </Pressable>
      </Modal>

    </View>
  );
}

/* ── Styles ────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },

  /* Top bar */
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.background,
  },
  topBarButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
  topBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  topBarIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarIconDisabled: {
    opacity: 0.35,
  },

  /* Controls */
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 40,
    paddingTop: 20,
    paddingBottom: 32,
    backgroundColor: theme.colors.background,
  },
  sideAction: {
    alignItems: "center",
    gap: 4,
    width: 56,
  },
  sideIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  sideLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: theme.colors.textSecondary,
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: theme.colors.textPrimary,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  captureDisabled: {
    opacity: 0.6,
  },
  captureInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: theme.colors.surface,
  },
  captureInnerReady: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: theme.colors.textPrimary,
    alignItems: "center",
    justifyContent: "center",
  },

  /* Permission */
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
    backgroundColor: theme.colors.background,
  },
  permMessage: {
    color: theme.colors.textSecondary,
    textAlign: "center",
    fontSize: 16,
    lineHeight: 24,
  },
  permButton: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: theme.radius.button,
  },
  permButtonText: {
    color: theme.colors.accentText,
    fontWeight: "600",
    fontSize: 16,
  },
});
