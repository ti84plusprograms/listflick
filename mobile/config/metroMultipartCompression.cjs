const compression = require("compression");

function isBundleRequest(url = "") {
  try {
    return new URL(url, "http://localhost").pathname.endsWith(".bundle");
  } catch {
    return false;
  }
}

function isMultipartMixedResponse(response) {
  const contentType = response.getHeader("Content-Type");
  return typeof contentType === "string"
    && contentType.toLowerCase().startsWith("multipart/mixed");
}

function shouldCompressMultipartBundle(request, response) {
  return isBundleRequest(request.url) && isMultipartMixedResponse(response);
}

function withMultipartBundleCompression(middleware) {
  const compressMultipart = compression({
    enforceEncoding: "gzip",
    filter: shouldCompressMultipartBundle,
  });

  return (request, response, next) => {
    if (!isBundleRequest(request.url)) {
      return middleware(request, response, next);
    }

    return compressMultipart(request, response, () => (
      middleware(request, response, next)
    ));
  };
}

module.exports = {
  isBundleRequest,
  isMultipartMixedResponse,
  shouldCompressMultipartBundle,
  withMultipartBundleCompression,
};
