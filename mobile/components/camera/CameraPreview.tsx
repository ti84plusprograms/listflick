import React, { forwardRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { CameraView, CameraType } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../../constants/theme";

interface CameraPreviewProps {
  hasPermission: boolean;
  facing: CameraType;
  flashEnabled: boolean;
  scanningMode: boolean;
  scanAnim: Animated.Value;
}

export const CameraPreview = forwardRef<CameraView, CameraPreviewProps>(
  ({ hasPermission, facing, flashEnabled, scanningMode, scanAnim }, ref) => {
    return (
      <View style={styles.viewfinderContainer}>
        {hasPermission ? (
          <CameraView
            ref={ref}
            style={styles.camera}
            facing={facing}
            flash={flashEnabled ? "on" : "off"}
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

        {/* Dashed guide overlay */}
        <View style={styles.guideOverlay} pointerEvents="none">
          <View style={styles.guideDashed} />
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
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
  guideOverlay: {
    ...StyleSheet.absoluteFillObject,
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
});
