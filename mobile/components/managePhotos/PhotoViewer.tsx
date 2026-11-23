import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "../../constants/theme";
import { invalidateAuthenticatedImageUri } from "../../services/imageRetrieval";
import {
  photoLoadStateAfterEnd,
  viewerPageKeyAfterMomentum,
  type ManagePhotoEntry,
  type PhotoLoadState,
} from "../../utils/managePhotos";
import { AuthenticatedImage } from "../AuthenticatedImage";

const VIEWER_HEADER_HEIGHT = 70;
const VIEWER_NAVIGATION_TOP_PADDING = 12;
const VIEWER_NAVIGATION_BUTTON_SIZE = 48;

interface PhotoViewerProps {
  photos: ManagePhotoEntry[];
  selectedKey: string | null;
  onSelectedKeyChange: (key: string) => void;
  onClose: () => void;
}

export function PhotoViewer({
  photos,
  selectedKey,
  onSelectedKeyChange,
  onClose,
}: PhotoViewerProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ManagePhotoEntry>>(null);
  const closingRef = useRef(false);
  const [imageStates, setImageStates] = useState<Record<string, PhotoLoadState>>({});
  const [retryAttempts, setRetryAttempts] = useState<Record<string, number>>({});
  const selectedIndex = Math.max(0, photos.findIndex((photo) => photo.key === selectedKey));
  const visible = selectedKey !== null && photos.length > 0;
  const navigationBottomPadding = Math.max(insets.bottom, 20);
  const navigationHeight =
    VIEWER_NAVIGATION_TOP_PADDING + VIEWER_NAVIGATION_BUTTON_SIZE + navigationBottomPadding;

  const closeViewer = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    onClose();
  };

  const goToIndex = (index: number) => {
    const nextPhoto = photos[index];
    if (!nextPhoto) return;
    onSelectedKeyChange(nextPhoto.key);
    listRef.current?.scrollToIndex({ index, animated: true });
  };

  const setImageState = (key: string, state: PhotoLoadState) => {
    setImageStates((current) => current[key] === state ? current : { ...current, [key]: state });
  };

  const finishImageLoad = (key: string) => {
    setImageStates((current) => {
      const state = photoLoadStateAfterEnd(current[key]);
      return current[key] === state ? current : { ...current, [key]: state };
    });
  };

  const retryPhoto = (photo: ManagePhotoEntry) => {
    invalidateAuthenticatedImageUri(photo.uri);
    setImageState(photo.key, "loading");
    setRetryAttempts((current) => ({
      ...current,
      [photo.key]: (current[photo.key] ?? 0) + 1,
    }));
  };

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal
      onShow={() => {
        closingRef.current = false;
      }}
      onRequestClose={closeViewer}
      onDismiss={closeViewer}
    >
      <View style={styles.container} testID="photo-viewer">
        <FlatList
          key={`photo-viewer-${width}`}
          ref={listRef}
          data={photos}
          horizontal
          pagingEnabled
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(photo) => photo.key}
          initialScrollIndex={selectedIndex}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          onMomentumScrollEnd={(event) => {
            const index = Math.round(event.nativeEvent.contentOffset.x / width);
            const key = viewerPageKeyAfterMomentum(photos, index, closingRef.current);
            if (key) onSelectedKeyChange(key);
          }}
          renderItem={({ item: photo, index }) => {
            const state = imageStates[photo.key] ?? "loading";
            return (
              <View
                style={[
                  styles.imagePage,
                  {
                    width,
                    paddingTop: VIEWER_HEADER_HEIGHT,
                    paddingBottom: navigationHeight,
                  },
                ]}
              >
                <View style={styles.imageStage}>
                  <AuthenticatedImage
                    key={`${photo.key}:${retryAttempts[photo.key] ?? 0}`}
                    uri={photo.uri}
                    style={styles.image}
                    resizeMode="contain"
                    accessible
                    accessibilityLabel={`Photo ${index + 1} of ${photos.length}`}
                    onSourceResolved={() => setImageState(photo.key, "loaded")}
                    onLoad={() => setImageState(photo.key, "loaded")}
                    onLoadEnd={() => finishImageLoad(photo.key)}
                    onError={() => setImageState(photo.key, "error")}
                  />
                  {state === "loading" && (
                    <ActivityIndicator
                      accessibilityLabel="Loading photo"
                      color={theme.colors.textSecondary}
                      size="large"
                      style={styles.centeredOverlay}
                    />
                  )}
                  {state === "error" && (
                    <View style={styles.errorOverlay}>
                      <Ionicons name="image-outline" size={36} color={theme.colors.textPrimary} />
                      <Text style={styles.errorText}>Could not load this photo.</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Retry photo ${index + 1}`}
                        onPress={() => retryPhoto(photo)}
                        style={styles.retryButton}
                      >
                        <Text style={styles.retryText}>Retry</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              </View>
            );
          }}
        />

        <View style={styles.header}>
          <View pointerEvents="none" style={styles.grabberContainer}>
            <View style={styles.grabber} />
          </View>
          <View style={styles.headerSpacer} />
          <Text accessibilityLiveRegion="polite" style={styles.positionText}>
            Photo {selectedIndex + 1} of {photos.length}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close photo viewer"
            testID="photo-viewer-close"
            hitSlop={12}
            onPress={closeViewer}
            style={styles.closeButton}
          >
            <Ionicons name="close" size={30} color={theme.colors.textPrimary} />
          </Pressable>
        </View>

        <View
          style={[
            styles.navigation,
            { height: navigationHeight, paddingBottom: navigationBottomPadding },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous photo"
            testID="photo-viewer-previous"
            disabled={selectedIndex === 0}
            onPress={() => goToIndex(selectedIndex - 1)}
            style={[styles.navigationButton, selectedIndex === 0 && styles.disabledButton]}
          >
            <Ionicons name="chevron-back" size={28} color={theme.colors.textPrimary} />
          </Pressable>
          <Text style={styles.swipeHint}>Swipe to browse</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next photo"
            testID="photo-viewer-next"
            disabled={selectedIndex === photos.length - 1}
            onPress={() => goToIndex(selectedIndex + 1)}
            style={[
              styles.navigationButton,
              selectedIndex === photos.length - 1 && styles.disabledButton,
            ]}
          >
            <Ionicons name="chevron-forward" size={28} color={theme.colors.textPrimary} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    height: VIEWER_HEADER_HEIGHT,
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.94)",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  grabberContainer: {
    position: "absolute",
    top: 7,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(26,26,26,0.24)",
  },
  headerSpacer: {
    width: 44,
  },
  positionText: {
    flex: 1,
    textAlign: "center",
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: "600",
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  imagePage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  imageStage: {
    flex: 1,
    width: "100%",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  centeredOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
  },
  errorText: {
    color: theme.colors.textPrimary,
    fontSize: 15,
  },
  retryButton: {
    minHeight: 44,
    minWidth: 88,
    marginTop: 8,
    paddingHorizontal: 20,
    borderRadius: theme.radius.button,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
  },
  retryText: {
    color: theme.colors.accentText,
    fontSize: 15,
    fontWeight: "600",
  },
  navigation: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    paddingTop: VIEWER_NAVIGATION_TOP_PADDING,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.94)",
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSubtle,
  },
  navigationButton: {
    width: VIEWER_NAVIGATION_BUTTON_SIZE,
    height: VIEWER_NAVIGATION_BUTTON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  disabledButton: {
    opacity: 0.3,
  },
  swipeHint: {
    color: theme.colors.textSecondary,
    fontSize: 13,
  },
});
