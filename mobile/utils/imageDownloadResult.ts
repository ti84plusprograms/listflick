export type ImageDownloadFailure = {
  index: number;
  category: "unsupported" | "authentication" | "download" | "media_library" | "unknown";
};

export type ImageDownloadResult = {
  total: number;
  saved: number;
  failures: ImageDownloadFailure[];
};

export function formatImageDownloadResult(result: ImageDownloadResult): { title: string; message: string } {
  if (result.saved === result.total && result.total > 0) {
    return { title: "Saved", message: `Saved ${result.saved} photo${result.saved === 1 ? "" : "s"} to your camera roll.` };
  }
  if (result.saved > 0) {
    return { title: "Partially saved", message: `Saved ${result.saved} of ${result.total} photos. Some photos could not be downloaded.` };
  }
  return { title: "Photos not saved", message: "No photos could be saved. Check your connection and try again." };
}
