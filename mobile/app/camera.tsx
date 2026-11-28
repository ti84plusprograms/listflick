import { CameraType, CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { File } from "expo-file-system";
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
import { getApp } from "@react-native-firebase/app";
import { getAuth } from "@react-native-firebase/auth";
import { theme, themedStyles } from "../constants/theme";
import { CameraPreview } from "../components/camera/CameraPreview";
import { PhotoManager } from "../components/camera/PhotoManager";
import { ListingVideoPlayer } from "../components/media/ListingVideoPlayer";
import { extractVideoFrames, videoPosterUri } from "../services/videoFrames";
import type { ListingVideo } from "../types/listing";
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  VIDEO_TOO_LARGE_MESSAGE,
  addVideoNotice,
  isVideoAsset,
  videoMimeType,
} from "../utils/listingVideo";
import { getHealth } from "../services/api";
import { hasProviderApiKey, isAIProvider } from "../services/aiCredentials";
import {
  getEffectiveAIProvider,
  getSelectedAIProvider,
  savePendingAnalysisOperation,
} from "../services/storage";
import { createPendingAnalysisOperation } from "../utils/pendingAnalysis";
import {
  deletePendingAnalysisImages,
  persistPendingAnalysisImages,
  persistPendingAnalysisVideo,
} from "../utils/pendingAnalysisFiles";
import { showAIKeyRequiredPrompt, showAIProviderRequiredPrompt } from "../utils/aiCredentialPrompt";
import { isServerAIKeyFallbackAvailable, providerServerKeyConfigured as serverKeyConfiguredFor } from "../utils/aiProviderAvailability";
import { providerDisplayName } from "../utils/aiSettingsState";

// Leave room under the upload limit for the container and the frames sent alongside.
const MAX_RECORDING_BYTES = MAX_VIDEO_BYTES - 5 * 1024 * 1024;

function recordedFileSize(uri: string): number | undefined {
  try {
    const size = new File(uri).size;
    return typeof size === "number" && size > 0 ? size : undefined;
  } catch {
    return undefined;
  }
}

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
  // One video per listing (Marketplace's separate "Add video" slot).
  const [video, setVideo] = useState<ListingVideo | null>(null);
  const [captureMode, setCaptureMode] = useState<"photo" | "video">("photo");
  const [recordingSeconds, setRecordingSeconds] = useState<number | null>(null);
  const [previewVideo, setPreviewVideo] = useState(false);
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const recordingStartedAt = useRef<number | null>(null);
  // Set synchronously on the first tap so a second tap during the AI preflight can't start a
  // second recording that the UI then loses track of.
  const recordingBusy = useRef(false);
  const videoRef = useRef<ListingVideo | null>(null);
  videoRef.current = video;
  const isRecording = recordingSeconds !== null;

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

    const currentUser = getAuth(getApp()).currentUser;
    if (!currentUser) {
      Alert.alert("Sign In Required", "Sign in before starting an AI listing.");
      return false;
    }

    const health = await getHealth().catch(() => null);
    const savedProvider = await getSelectedAIProvider();
    const provider = await getEffectiveAIProvider(health);
    const backendProvider = isAIProvider(health?.ai_provider) ? health.ai_provider : "none";
    const fallbackEnabled = health?.allow_server_ai_key_fallback === true;
    const providerServerKeyConfigured = provider ? serverKeyConfiguredFor(health, provider) : false;
    const fallbackAvailable = provider
      ? isServerAIKeyFallbackAvailable(health, provider)
      : false;
    const hasDeviceKey = provider
      ? await hasProviderApiKey(currentUser.uid, provider)
      : false;
    console.log(
      `[AI] Camera pre-flight: savedProvider=${savedProvider ?? "none"}, backendProvider=${backendProvider}, effectiveProvider=${provider ?? "none"}, deviceKey=${hasDeviceKey}, fallbackEnabled=${fallbackEnabled}, providerServerKeyConfigured=${providerServerKeyConfigured}, serverFallbackAvailable=${fallbackAvailable}, healthAvailable=${health !== null}`,
    );
    if (!provider) {
      showAIProviderRequiredPrompt();
      return false;
    }
    if (hasDeviceKey || fallbackAvailable) {
      aiPreflightPassed.current = true;
      return true;
    }

    showAIKeyRequiredPrompt(provider, `Add your ${providerDisplayName(provider)} API key before taking listing photos.`);
    return false;
  }, []);

  const goToProcessing = async (uris: string[], listingVideo: ListingVideo | null = video) => {
    if (startingProcessing) return;
    if (!(await ensureAIProviderReady())) return;
    setStartingProcessing(true);
    let operationId: string | undefined;
    try {
      const operation = createPendingAnalysisOperation(uris);
      operationId = operation.operationId;
      const durableImageUris = await persistPendingAnalysisImages(operation.operationId, uris);
      // Candidate frames are extracted on the phone; the backend keeps the best ones.
      const durableVideo = listingVideo
        ? await persistPendingAnalysisVideo(operation.operationId, {
          uri: listingVideo.uri,
          durationSeconds: listingVideo.durationSeconds,
          mimeType: listingVideo.mimeType,
          sizeBytes: listingVideo.sizeBytes,
          frames: await extractVideoFrames(listingVideo.uri, listingVideo.durationSeconds),
        })
        : undefined;
      await savePendingAnalysisOperation({
        ...operation,
        imageUris: durableImageUris,
        ...(durableVideo ? { video: durableVideo } : {}),
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

  const attachVideo = useCallback(async (next: ListingVideo, pickedCount = 1) => {
    if (next.sizeBytes && next.sizeBytes > MAX_VIDEO_BYTES) {
      Alert.alert("Video too large", VIDEO_TOO_LARGE_MESSAGE);
      return;
    }
    const posterUri = await videoPosterUri(next.uri, next.durationSeconds);
    const notice = addVideoNotice(videoRef.current, pickedCount);
    setVideo({ ...next, posterUri: posterUri ?? undefined });
    if (notice) Alert.alert("One video per listing", notice);
  }, []);

  const startRecording = async () => {
    if (!cameraRef.current || recordingSeconds !== null || recordingBusy.current) return;
    recordingBusy.current = true;
    try {
      if (!(await ensureAIProviderReady()) || !cameraRef.current) return;
      recordingStartedAt.current = Date.now();
      setRecordingSeconds(0);
      try {
        const recorded = await cameraRef.current.recordAsync({
          maxDuration: MAX_VIDEO_SECONDS,
          // Stop before the upload limit; the camera also records at 720p to keep clips small.
          maxFileSize: MAX_RECORDING_BYTES,
        });
        const startedAt = recordingStartedAt.current ?? Date.now();
        const durationSeconds = Math.max(1, (Date.now() - startedAt) / 1000);
        if (recorded?.uri) {
          await attachVideo({
            uri: recorded.uri,
            durationSeconds: Math.min(durationSeconds, MAX_VIDEO_SECONDS),
            mimeType: videoMimeType(recorded.uri),
            sizeBytes: recordedFileSize(recorded.uri),
          });
        }
      } catch {
        Alert.alert("Error", "Could not record the video. Please try again.");
      } finally {
        recordingStartedAt.current = null;
        setRecordingSeconds(null);
      }
    } finally {
      recordingBusy.current = false;
    }
  };

  const stopRecording = () => {
    cameraRef.current?.stopRecording();
  };

  const selectCaptureMode = async (mode: "photo" | "video") => {
    setCaptureMode(mode);
    // Sound is optional: ask once when switching to video; without it the clip is muted.
    if (mode === "video" && !microphonePermission?.granted && microphonePermission?.canAskAgain !== false) {
      await requestMicrophonePermission();
    }
  };

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => {
      const startedAt = recordingStartedAt.current;
      if (startedAt) setRecordingSeconds((Date.now() - startedAt) / 1000);
    }, 500);
    return () => clearInterval(timer);
  }, [isRecording]);

  useFocusEffect(
    useCallback(() => () => {
      // Leaving the screen ends a recording instead of leaving the camera running.
      if (recordingStartedAt.current) cameraRef.current?.stopRecording();
    }, []),
  );

  const pickFromGallery = useCallback(async () => {
    if (!(await ensureAIProviderReady())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, 8 - imageUris.length) + 1,
      quality: 0.8,
      videoMaxDuration: MAX_VIDEO_SECONDS,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      const videos = result.assets.filter((asset) => isVideoAsset(asset));
      const photos = result.assets.filter((asset) => !isVideoAsset(asset));
      if (photos.length > 0) {
        setImageUris((current) => [...current, ...photos.map((asset) => asset.uri)].slice(0, 8));
      }
      const picked = videos[0];
      if (picked) {
        await attachVideo(
          {
            uri: picked.uri,
            durationSeconds: (picked.duration ?? 0) / 1000,
            mimeType: videoMimeType(picked.uri, picked.mimeType),
            sizeBytes: picked.fileSize ?? undefined,
          },
          videos.length,
        );
      }
    }
  }, [attachVideo, ensureAIProviderReady, imageUris.length]);

  useEffect(() => {
    if (params.openPicker !== "true" || openedPickerFromParam.current) return;
    openedPickerFromParam.current = true;
    void pickFromGallery();
  }, [params.openPicker, pickFromGallery]);

  /* ── Permission states ─────────────────────────────────── */

  const hasMedia = imageUris.length > 0 || video !== null;

  if (!permission && !hasMedia) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.textPrimary} />
      </View>
    );
  }

  if (!permission?.granted && !hasMedia) {
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
    <View style={styles.container}>
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
            accessibilityLabel="Analyze selected photos"
            style={[styles.topBarButton, { marginLeft: 12 }, (!hasMedia || startingProcessing || recordingSeconds !== null) && { opacity: 0.5 }]}
            disabled={!hasMedia || startingProcessing || recordingSeconds !== null}
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
        mode={captureMode === "video" ? "video" : "picture"}
        mute={!microphonePermission?.granted}
        recordingSeconds={recordingSeconds}
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
        video={video}
        onRemoveVideo={() => setVideo(null)}
        onPreviewVideo={() => setPreviewVideo(true)}
      />

      {/* Photo / Video switch */}
      <View style={styles.modeSwitch} accessibilityRole="tablist">
        {(["photo", "video"] as const).map((mode) => (
          <Pressable
            key={mode}
            onPress={() => void selectCaptureMode(mode)}
            disabled={recordingSeconds !== null}
            accessibilityRole="tab"
            accessibilityState={{ selected: captureMode === mode }}
            style={[styles.modeOption, captureMode === mode && styles.modeOptionActive]}
          >
            <Text style={[styles.modeText, captureMode === mode && styles.modeTextActive]}>
              {mode === "photo" ? "Photo" : "Video"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Bottom controls */}
      <View style={styles.controls}>
        {/* Library */}
        <Pressable
          style={styles.sideAction}
          onPress={pickFromGallery}
          accessibilityLabel="Choose more photos from library"
        >
          <View style={styles.sideIconBox}>
            <Ionicons name="images-outline" size={22} color={theme.colors.textPrimary} />
          </View>
          <Text style={styles.sideLabel}>Library</Text>
        </Pressable>

        {/* Capture Area */}
        <View style={{ alignItems: "center", justifyContent: "center", zIndex: 10 }}>
          {captureMode === "video" ? (
            <Pressable
              style={styles.captureButton}
              onPress={recordingSeconds === null ? () => void startRecording() : stopRecording}
              accessibilityRole="button"
              accessibilityLabel={recordingSeconds === null ? "Record video" : "Stop recording"}
            >
              <View style={recordingSeconds === null ? styles.recordInner : styles.recordStop} />
            </Pressable>
          ) : (
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
          )}
        </View>

        {/* Flip */}
        <Pressable style={styles.sideAction} onPress={toggleFacing} disabled={recordingSeconds !== null}>
          <View style={styles.sideIconBox}>
            <Ionicons name="camera-reverse-outline" size={22} color={theme.colors.textPrimary} />
          </View>
          <Text style={styles.sideLabel}>Flip</Text>
        </Pressable>
      </View>

      {/* Video preview */}
      <Modal visible={previewVideo && !!video} transparent animationType="fade" onRequestClose={() => setPreviewVideo(false)}>
        <View style={styles.videoModal}>
          {video && <ListingVideoPlayer uri={video.uri} style={styles.videoModalPlayer} />}
          <Pressable style={styles.videoModalClose} onPress={() => setPreviewVideo(false)} accessibilityLabel="Close video">
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </Pressable>
        </View>
      </Modal>

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

const styles = themedStyles(() => StyleSheet.create({
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
  recordInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FF3B30",
  },
  recordStop: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: "#FF3B30",
  },
  modeSwitch: {
    flexDirection: "row",
    alignSelf: "center",
    marginTop: 12,
    padding: 3,
    borderRadius: theme.radius.chip,
    backgroundColor: theme.colors.surface,
  },
  modeOption: {
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: theme.radius.chip,
  },
  modeOptionActive: {
    backgroundColor: theme.colors.accent,
  },
  modeText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.textSecondary,
  },
  modeTextActive: {
    color: theme.colors.accentText,
  },
  videoModal: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
  },
  videoModalPlayer: {
    width: "100%",
    height: "80%",
  },
  videoModalClose: {
    position: "absolute",
    top: 56,
    right: 20,
    padding: 8,
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
}));
