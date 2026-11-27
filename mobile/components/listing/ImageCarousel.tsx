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
import { Ionicons } from "@expo/vector-icons";
import { theme, themedStyles } from "../../constants/theme";
import type { ListingVideo } from "../../types/listing";
import { AuthenticatedImage } from "../AuthenticatedImage";
import { ListingVideoPlayer } from "../media/ListingVideoPlayer";
import { carouselSlides, clampCarouselIndex, carouselIndexAfterMomentum } from "./imageCarouselState";

/** Photos in listing order, then the video (if any) as the last slide. */
export function ImageCarousel({ imageUris, video }: { imageUris: string[]; video?: ListingVideo | null }) {
  const { width: windowWidth } = useWindowDimensions();
  const [pageWidth, setPageWidth] = useState(windowWidth);
  const [activeIndexState, setActiveIndex] = useState(0);
  const slides = carouselSlides(imageUris, video?.uri);
  const slideCount = slides.length;
  const activeIndex = clampCarouselIndex(activeIndexState, slideCount);
  const activeSlide = slides[activeIndex];

  useEffect(() => {
    setActiveIndex((current) => clampCarouselIndex(current, slideCount));
  }, [slideCount]);

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
        slideCount,
      );
      setActiveIndex((current) => (current === nextIndex ? current : nextIndex));
    },
    [slideCount, pageWidth],
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

  if (slideCount === 0) return null;

  return (
    <View onLayout={handleLayout} style={styles.photoContainer}>
      <FlatList
        key={`listing-preview-${pageWidth}-${slideCount}`}
        data={slides}
        horizontal
        pagingEnabled
        accessible
        accessibilityLabel={activeSlide?.kind === "video"
          ? "Video"
          : `Photo ${activeIndex + 1} of ${imageUris.length}`}
        accessibilityLiveRegion="polite"
        showsHorizontalScrollIndicator={false}
        keyExtractor={(slide, index) => `${slide.kind}-${slide.uri}-${index}`}
        renderItem={({ item: slide }) =>
          slide.kind === "video" ? (
            <ListingVideoPlayer
              uri={slide.uri}
              style={{ width: pageWidth, height: pageWidth * 0.8 }}
            />
          ) : (
            <AuthenticatedImage
              uri={slide.uri}
              style={[styles.mainPhoto, { width: pageWidth, height: pageWidth * 0.8 }]}
            />
          )
        }
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
      {slideCount > 1 && (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={styles.dotContainer}
        >
          {slides.map((slide, i) =>
            slide.kind === "video" ? (
              <Ionicons
                key={i}
                name="videocam"
                size={10}
                color={i === activeIndex ? "#FFFFFF" : "rgba(255,255,255,0.5)"}
              />
            ) : (
              <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
            ),
          )}
        </View>
      )}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
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
    alignItems: "center",
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
}));
