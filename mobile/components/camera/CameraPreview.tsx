import React, { forwardRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { CameraView, CameraType, type CameraMode } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { theme, themedStyles } from "../../constants/theme";

interface CameraPreviewProps {
  hasPermission: boolean;
  facing: CameraType;
  flashEnabled: boolean;
  scanningMode: boolean;
  scanAnim: Animated.Value;
  /** "video" switches the camera to recording; photos use "picture". */
  mode?: CameraMode;
  /** Record without sound (no microphone permission). */
  mute?: boolean;
  /** Seconds recorded so far, shown while recording. */
  recordingSeconds?: number | null;
}

export const CameraPreview = forwardRef<CameraView, CameraPreviewProps>(
  ({ hasPermission, facing, flashEnabled, scanningMode, scanAnim, mode = "picture", mute = false, recordingSeconds = null }, ref) => {
    return (
      <View style={styles.viewfinderContainer}>
        {hasPermission ? (
          <CameraView
            ref={ref}
            style={styles.camera}
            facing={facing}
            flash={flashEnabled ? "on" : "off"}
            mode={mode}
            mute={mute}
            // 1080p runs about 15 Mbps, so a 60 s clip would pass the 100 MB upload limit.
            videoQuality="720p"
          />
        ) : (
          <View style={[styles.camera, styles.cameraUnavailable]}>
            <Ionicons name="images-outline" size={36} color={theme.colors.textTertiary} />
            <Text style={styles.cameraUnavailableText}>Selected photos are ready.</Text>
          </View>
        )}

        {/* Scanning Overlay */}
        {scanningMode && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)" }} />
            <Animated.View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                height: 4,
                backgroundColor: theme.colors.accent,
                shadowColor: theme.colors.accent,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 1,
                shadowRadius: 10,
                elevation: 5,
                transform: [
                  {
                    translateY: scanAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, 500], // Roughly the height of the viewfinder
                    }),
                  },
                ],
              }}
            />
          </View>
        )}

        {recordingSeconds !== null && (
          <View style={styles.recordingBadge} accessibilityLiveRegion="polite">
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>
              {`${Math.floor(recordingSeconds / 60)}:${String(Math.floor(recordingSeconds % 60)).padStart(2, "0")}`}
            </Text>
          </View>
        )}

        {/* Dashed guide overlay */}
        <View style={styles.guideOverlay} pointerEvents="none">
          <View style={styles.guideDashed} />
        </View>
      </View>
    );
  }
);

const styles = themedStyles(() => StyleSheet.create({
  viewfinderContainer: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#E8E8E8",
  },
  camera: {
    flex: 1,
  },
  cameraUnavailable: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.surface,
  },
  cameraUnavailableText: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.textSecondary,
  },
  recordingBadge: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.chip,
    backgroundColor: "rgba(0,0,0,0.6)",
    zIndex: 5,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF3B30",
  },
  recordingText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  guideOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  guideDashed: {
    width: "80%",
    height: "70%",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.6)",
    borderStyle: "dashed",
    borderRadius: 16,
  },
}));
