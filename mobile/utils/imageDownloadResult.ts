export type ImageDownloadFailure = {
  index: number;
  category: "unsupported" | "authentication" | "download" | "media_library" | "unknown";
};

export type ImageDownloadResult = {
  total: number;
  saved: number;
  failures: ImageDownloadFailure[];
};

const PHOTOS_ACCESS_HINT = "Check that Photos access is allowed for ListFlick in Settings, then try again.";

export function formatImageDownloadResult(result: ImageDownloadResult): { title: string; message: string } {
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
