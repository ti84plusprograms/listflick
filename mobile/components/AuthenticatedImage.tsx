import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  ImageErrorEventData,
  ImageLoadEventData,
  ImageProps,
  ImageSourcePropType,
  NativeSyntheticEvent,
} from "react-native";

import { isProtectedApiUrl, resolveAuthenticatedImageUri } from "../services/imageRetrieval";

type Props = Omit<ImageProps, "source"> & {
  uri: string;
  onSourceResolved?: () => void;
};

function debugLog(message: string, details?: Record<string, unknown>) {
  if (__DEV__) console.log(`[ImageRetrieval] ${message}`, details ?? "");
}

function debugWarn(message: string, details?: Record<string, unknown>) {
  if (__DEV__) console.warn(`[ImageRetrieval] ${message}`, details ?? "");
}

/** Loads local images directly and adds Firebase auth to backend image URLs. */
export function AuthenticatedImage({ uri, onSourceResolved, ...props }: Props) {
  const [source, setSource] = useState<ImageSourcePropType | undefined>(() =>
    isProtectedApiUrl(uri) ? undefined : { uri },
  );
  const onErrorRef = useRef(props.onError);
  onErrorRef.current = props.onError;
  const onSourceResolvedRef = useRef(onSourceResolved);
  onSourceResolvedRef.current = onSourceResolved;

  useEffect(() => {
    let active = true;
    const protectedUrl = isProtectedApiUrl(uri);
    debugLog("image source evaluation", { uri, protectedUrl });
    if (!protectedUrl) {
      setSource({ uri });
      onSourceResolvedRef.current?.();
      return () => { active = false; };
    }

    setSource(undefined);
    resolveAuthenticatedImageUri(uri)
      .then((resolved) => {
        if (!active) return;
        setSource({ uri: resolved.uri, cache: "force-cache", headers: resolved.headers });
        onSourceResolvedRef.current?.();
        debugLog("authenticated image source attached", { uri });
      })
      .catch((error) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : String(error);
        debugWarn("Firebase image resolution failed", { uri, error: message });
        setSource(undefined);
        onErrorRef.current?.({
          nativeEvent: { error: message },
        } as NativeSyntheticEvent<ImageErrorEventData>);
      });

    return () => { active = false; };
  }, [uri]);

  const onLoad = (event: NativeSyntheticEvent<ImageLoadEventData>) => {
    debugLog("image loaded", { uri, width: event.nativeEvent.source.width, height: event.nativeEvent.source.height });
    props.onLoad?.(event);
  };

  const onError = (event: NativeSyntheticEvent<{ error: string }>) => {
    debugWarn("image failed to load", { uri, error: event.nativeEvent.error });
    onErrorRef.current?.(event);
  };

  return <Image {...props} source={source} onLoad={onLoad} onError={onError} />;
}
