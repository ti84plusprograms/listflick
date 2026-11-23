export function clampCarouselIndex(index: number, imageCount: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(imageCount) || imageCount <= 0) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), imageCount - 1);
}

export function carouselIndexAfterMomentum(
  contentOffsetX: number,
  pageWidth: number,
  imageCount: number,
): number {
  if (!Number.isFinite(contentOffsetX) || !Number.isFinite(pageWidth) || pageWidth <= 0) {
    return 0;
  }

  return clampCarouselIndex(Math.round(contentOffsetX / pageWidth), imageCount);
}
