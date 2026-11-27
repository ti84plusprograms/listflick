import React from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme, themedStyles } from "../../constants/theme";
import type { ListingVideo } from "../../types/listing";
import { formatVideoDuration } from "../../utils/listingVideo";

interface PhotoManagerProps {
  imageUris: string[];
  onRemoveImage: (uri: string) => void;
  onAddImage: () => void;
  onPreviewImage: (uri: string) => void;
  /** The listing's one video, shown after the photos with its duration. */
  video?: ListingVideo | null;
  onRemoveVideo?: () => void;
  onPreviewVideo?: () => void;
}

export function PhotoManager({
  imageUris,
  onRemoveImage,
  onAddImage,
  onPreviewImage,
  video,
  onRemoveVideo,
  onPreviewVideo,
}: PhotoManagerProps) {
  return (
    <View style={styles.tray}>
      <View style={styles.trayContent}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.trayScroll}
        >
          {imageUris.map((uri, index) => (
            <Pressable
              key={`${uri}-${index}`}
              onPress={() => onPreviewImage(uri)}
              style={styles.thumbWrap}
            >
              <Image source={{ uri }} style={styles.thumbImage} />
              <Pressable
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  backgroundColor: "rgba(255, 255, 255, 0.9)",
                  borderRadius: 20,
                  width: 20,
                  height: 20,
                  justifyContent: "center",
                  alignItems: "center",
                  zIndex: 10,
                  borderWidth: 1,
                  borderColor: "rgba(0,0,0,0.1)",
                }}
                onPress={() => onRemoveImage(uri)}
              >
                <Ionicons name="close" size={14} color="#FF3B30" />
              </Pressable>
            </Pressable>
          ))}

          {video && (
            <Pressable
              onPress={onPreviewVideo}
              style={styles.thumbWrap}
              accessibilityRole="button"
              accessibilityLabel={`Video, ${formatVideoDuration(video.durationSeconds)}`}
              // The remove button is nested, so screen readers reach it through an action.
              accessibilityActions={[{ name: "remove", label: "Remove video" }]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "remove") onRemoveVideo?.();
              }}
            >
              {video.posterUri ? (
                <Image source={{ uri: video.posterUri }} style={styles.thumbImage} />
              ) : (
                <View style={[styles.thumbImage, styles.videoThumbEmpty]}>
                  <Ionicons name="videocam" size={22} color={theme.colors.textSecondary} />
                </View>
              )}
              <View style={styles.durationBadge}>
                <Ionicons name="videocam" size={11} color="#FFFFFF" />
                <Text style={styles.durationText}>{formatVideoDuration(video.durationSeconds)}</Text>
              </View>
              <Pressable
                style={styles.removeVideo}
                onPress={onRemoveVideo}
                accessibilityRole="button"
                accessibilityLabel="Remove video"
              >
                <Ionicons name="close" size={14} color="#FF3B30" />
              </Pressable>
            </Pressable>
          )}

          {/* Add button */}
          {imageUris.length < 8 && (
            <Pressable style={styles.addThumb} onPress={onAddImage}>
              <Ionicons name="add" size={24} color={theme.colors.textTertiary} />
            </Pressable>
          )}
        </ScrollView>

        <Text
          style={styles.photoCount}
          testID="selected-photo-count"
          accessibilityLabel={imageUris.length === 1 ? "1 selected photo" : `${imageUris.length} selected photos`}
        >
          {[
            imageUris.length > 0 ? `${imageUris.length} photo${imageUris.length === 1 ? "" : "s"}` : "",
            video ? "1 video" : "",
          ].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  tray: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  trayContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  trayScroll: {
    gap: 8,
    flexGrow: 2,
  },
  thumbWrap: {
    position: "relative",
  },
  thumbImage: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
  },
  videoThumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  durationBadge: {
    position: "absolute",
    left: 4,
    bottom: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  durationText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "600",
  },
  removeVideo: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderRadius: 20,
    width: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
  },
  addThumb: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  photoCount: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontWeight: "500",
    marginLeft: 12,
    minWidth: 60,
    textAlign: "right",
  },
}));
