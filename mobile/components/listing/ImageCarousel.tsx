import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { theme } from "../../constants/theme";
import { AuthenticatedImage } from "../AuthenticatedImage";
import { clampCarouselIndex, carouselIndexAfterMomentum } from "./imageCarouselState";

export function ImageCarousel({ imageUris }: { imageUris: string[] }) {
  const { width: windowWidth } = useWindowDimensions();
  const [pageWidth, setPageWidth] = useState(windowWidth);
  const [activeIndexState, setActiveIndex] = useState(0);
  const activeIndex = clampCarouselIndex(activeIndexState, imageUris.length);

  useEffect(() => {
    setActiveIndex((current) => clampCarouselIndex(current, imageUris.length));
  }, [imageUris.length]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const measuredWidth = event.nativeEvent.layout.width;
    if (measuredWidth <= 0) return;
    setPageWidth((current) =>
      Math.abs(current - measuredWidth) < 0.5 ? current : measuredWidth,
    );
  }, []);

  const updateActiveIndexFromOffset = useCallback(
    (contentOffsetX: number) => {
      const nextIndex = carouselIndexAfterMomentum(
        contentOffsetX,
        pageWidth,
        imageUris.length,
      );
      setActiveIndex((current) => (current === nextIndex ? current : nextIndex));
    },
    [imageUris.length, pageWidth],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateActiveIndexFromOffset(event.nativeEvent.contentOffset.x);
    },
    [updateActiveIndexFromOffset],
  );

  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateActiveIndexFromOffset(event.nativeEvent.contentOffset.x);
    },
    [updateActiveIndexFromOffset],
  );

  if (imageUris.length === 0) return null;

  return (
    <View onLayout={handleLayout} style={styles.photoContainer}>
      <FlatList
        key={`listing-preview-${pageWidth}-${imageUris.length}`}
        data={imageUris}
        horizontal
        pagingEnabled
        accessible
        accessibilityLabel={`Photo ${activeIndex + 1} of ${imageUris.length}`}
        accessibilityLiveRegion="polite"
        showsHorizontalScrollIndicator={false}
        keyExtractor={(uri, index) => `${uri}-${index}`}
        renderItem={({ item: uri }) => (
          <AuthenticatedImage
            uri={uri}
            style={[styles.mainPhoto, { width: pageWidth, height: pageWidth * 0.8 }]}
          />
        )}
        initialNumToRender={1}
        initialScrollIndex={activeIndex}
        maxToRenderPerBatch={1}
        windowSize={2}
        removeClippedSubviews
        getItemLayout={(_, index) => ({ length: pageWidth, offset: pageWidth * index, index })}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleMomentumScrollEnd}
      />
      {imageUris.length > 1 && (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={styles.dotContainer}
        >
          {imageUris.map((_, i) => (
            <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  photoContainer: {
    width: "100%",
    aspectRatio: 1.25,
    backgroundColor: theme.colors.surface,
  },
  mainPhoto: {
    resizeMode: "cover",
  },
  dotContainer: {
    position: "absolute",
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  dotActive: {
    backgroundColor: "#FFFFFF",
  },
});
