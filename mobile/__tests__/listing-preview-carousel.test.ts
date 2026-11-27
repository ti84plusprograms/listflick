import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  carouselSlides,
  clampCarouselIndex,
  carouselIndexAfterMomentum,
} from "../components/listing/imageCarouselState";

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

equal(carouselIndexAfterMomentum(320, 320, 3), 1, "a settled forward swipe selects photo two");
equal(carouselIndexAfterMomentum(0, 320, 3), 0, "a settled backward swipe selects photo one");
equal(carouselIndexAfterMomentum(140, 320, 3), 0, "a partial swipe that snaps back stays put");
equal(carouselIndexAfterMomentum(960, 320, 3), 2, "an overscroll clamps to the final photo");
equal(carouselIndexAfterMomentum(320, 0, 3), 0, "an unmeasured carousel stays at photo one");
equal(carouselIndexAfterMomentum(-120, 320, 3), 0, "a negative bounce clamps to photo one");
equal(clampCarouselIndex(4, 3), 2, "removing the active final photo clamps the index");
equal(clampCarouselIndex(1, 0), 0, "an empty image list has a safe index");
equal(clampCarouselIndex(Number.NaN, 3), 0, "an invalid index has a safe fallback");

const carouselSource = readFileSync(
  resolve(__dirname, "../components/listing/ImageCarousel.tsx"),
  "utf8",
);

equal(carouselSource.includes("onMomentumScrollEnd={handleMomentumScrollEnd}"), true, "settled paging updates state");
equal(carouselSource.includes("onScroll={handleScroll}"), true, "real-time scrolling updates state immediately");
equal(carouselSource.includes("scrollEventThrottle={16}"), true, "scroll events are throttled for responsive updates");
equal(carouselSource.includes("onLayout={handleLayout}"), true, "the carousel measures its rendered width");
equal(carouselSource.includes("i === activeIndex"), true, "the active dot follows carousel state");
equal(carouselSource.includes("slideCount > 1"), true, "one slide omits decorative dots");
equal(
  carouselSource.includes("initialScrollIndex={activeIndex}"),
  true,
  "a remounted carousel retains its clamped logical index",
);
equal(
  carouselSource.includes('key={`listing-preview-${pageWidth}-${slideCount}`}'),
  true,
  "width and image-count changes realign the list",
);
equal(
  carouselSource.includes("length: pageWidth, offset: pageWidth * index"),
  true,
  "measured width controls page offsets",
);
equal(
  carouselSource.includes("Photo ${activeIndex + 1} of ${imageUris.length}"),
  true,
  "the carousel exposes its current position accessibly",
);
equal(
  carouselSource.includes('importantForAccessibility="no-hide-descendants"'),
  true,
  "decorative dots are hidden from Android accessibility",
);
equal(
  carouselSource.includes("accessibilityElementsHidden"),
  true,
  "decorative dots are hidden from iOS accessibility",
);

// The video is the last slide, after every photo.
equal(
  JSON.stringify(carouselSlides(["a.jpg", "b.jpg"], "/api/items/1/video/v1")),
  JSON.stringify([
    { kind: "photo", uri: "a.jpg" },
    { kind: "photo", uri: "b.jpg" },
    { kind: "video", uri: "/api/items/1/video/v1" },
  ]),
  "photos come first and the video is the final slide",
);
equal(carouselSlides(["a.jpg"], null).length, 1, "no video adds no slide");
equal(carouselSource.includes("<ListingVideoPlayer"), true, "the video slide plays the video");
equal(carouselSource.includes('slide.kind === "video"'), true, "slides render by kind");

console.log("Listing preview carousel tests passed.");
