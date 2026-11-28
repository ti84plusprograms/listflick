export type ImageDownloadFailure = {
  index: number;
  category: "unsupported" | "authentication" | "download" | "media_library" | "unknown";
};

export type ImageDownloadResult = {
  total: number;
  saved: number;
  failures: ImageDownloadFailure[];
  /** The last item is the listing's video (photos come first). */
  videoIncluded?: boolean;
};

const PHOTOS_ACCESS_HINT = "Check that Photos access is allowed for ListFlick in Settings, then try again.";

export function formatImageDownloadResult(result: ImageDownloadResult): { title: string; message: string } {
  if (result.videoIncluded) return formatMediaDownloadResult(result);
  if (result.saved === result.total && result.total > 0) {
    return { title: "Saved", message: `Saved ${result.saved} photo${result.saved === 1 ? "" : "s"} to your camera roll.` };
  }
  // Only blame the network when a download or authentication step actually failed.
  const networkFailed = result.failures.some(
    (failure) => failure.category === "download" || failure.category === "authentication",
  );
  const libraryFailed = result.failures.some((failure) => failure.category === "media_library");
  const allLibrary = libraryFailed && result.failures.every((failure) => failure.category === "media_library");
  if (result.saved > 0) {
    const prefix = `Saved ${result.saved} of ${result.total} photos.`;
    if (networkFailed && libraryFailed) {
      return { title: "Partially saved", message: `${prefix} Some photos could not be downloaded or added to your library.` };
    }
    if (libraryFailed) {
      const which = allLibrary ? "the rest" : "some photos";
      return { title: "Partially saved", message: `${prefix} ListFlick couldn't add ${which} to your library. ${PHOTOS_ACCESS_HINT}` };
    }
    if (networkFailed) {
      return { title: "Partially saved", message: `${prefix} Some photos could not be downloaded.` };
    }
    return { title: "Partially saved", message: `${prefix} Some photos could not be saved.` };
  }
  if (networkFailed && libraryFailed) {
    return {
      title: "Photos not saved",
      message:
        "No photos could be saved. Some could not be downloaded and others couldn't be added to your library. Check your connection and that Photos access is allowed for ListFlick in Settings, then try again.",
    };
  }
  if (libraryFailed) {
    return { title: "Photos not saved", message: `ListFlick couldn't add the photos to your library. ${PHOTOS_ACCESS_HINT}` };
  }
  if (networkFailed) {
    return { title: "Photos not saved", message: "No photos could be saved. Check your connection and try again." };
  }
  return { title: "Photos not saved", message: "No photos could be saved. Try again." };
}

/** Wording for a save that includes the video (the last item). */
function formatMediaDownloadResult(result: ImageDownloadResult): { title: string; message: string } {
  const photoTotal = result.total - 1;
  const videoFailed = result.failures.some((failure) => failure.index === photoTotal);
  const photosSaved = result.saved - (videoFailed ? 0 : 1);
  const photos = `${photosSaved} photo${photosSaved === 1 ? "" : "s"}`;
  if (result.failures.length === 0 && result.total > 0) {
    return {
      title: "Saved",
      message: photoTotal > 0
        ? `Saved ${photos} and the video to your camera roll.`
        : "Saved the video to your camera roll.",
    };
  }
  const libraryFailed = result.failures.some((failure) => failure.category === "media_library");
  const hint = libraryFailed ? ` ${PHOTOS_ACCESS_HINT}` : " Check your connection and try again.";
  if (result.saved === 0) {
    return { title: "Nothing saved", message: `The photos and video could not be saved.${hint}` };
  }
  if (videoFailed && photosSaved === photoTotal) {
    return { title: "Video not saved", message: `Saved ${photos}, but the video could not be saved.${hint}` };
  }
  return {
    title: "Partially saved",
    message: `Saved ${result.saved} of ${result.total} (${videoFailed ? "the video was not saved" : "the video was saved"}).${hint}`,
  };
}
