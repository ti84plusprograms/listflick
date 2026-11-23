import React from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../../constants/theme";

interface PhotoManagerProps {
  imageUris: string[];
  onRemoveImage: (uri: string) => void;
  onAddImage: () => void;
  onPreviewImage: (uri: string) => void;
}

export function PhotoManager({
  imageUris,
  onRemoveImage,
  onAddImage,
  onPreviewImage,
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
          {imageUris.length > 0
            ? `${imageUris.length} photo${imageUris.length === 1 ? "" : "s"}`
            : ""}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
});
