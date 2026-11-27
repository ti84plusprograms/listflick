import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";
import { Ionicons } from "@expo/vector-icons";

import { theme, themedStyles } from "../../constants/theme";
import { imageUrl } from "../../services/api";
import { isProtectedApiUrl, resolveAuthenticatedImageUri } from "../../services/imageRetrieval";

type Props = {
  /** Local file URI or the backend video path. */
  uri: string;
  style?: StyleProp<ViewStyle>;
};

function ResolvedPlayer({ source, style }: { source: VideoSource; style?: StyleProp<ViewStyle> }) {
  const player = useVideoPlayer(source, (created) => {
    created.loop = false;
  });
  return (
    <VideoView
      player={player}
      style={[styles.video, style]}
      contentFit="contain"
      nativeControls
      accessibilityLabel="Item video"
    />
  );
}

/** Plays a listing video, adding Firebase auth (or a signed URL) for backend videos. */
export function ListingVideoPlayer({ uri, style }: Props) {
  const [source, setSource] = useState<VideoSource | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    const absolute = uri.startsWith("/") ? imageUrl(uri) : uri;
    if (!isProtectedApiUrl(absolute)) {
      setSource({ uri: absolute });
      return () => {
        active = false;
      };
    }
    setSource(null);
    resolveAuthenticatedImageUri(absolute)
      .then((resolved) => {
        if (active) setSource({ uri: resolved.uri, headers: resolved.headers });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [uri]);

  if (failed) {
    return (
      <View style={[styles.video, styles.placeholder, style]}>
        <Ionicons name="videocam-off-outline" size={28} color={theme.colors.textTertiary} />
        <Text style={styles.placeholderText}>Video unavailable</Text>
      </View>
    );
  }
  if (!source) {
    return (
      <View style={[styles.video, styles.placeholder, style]}>
        <ActivityIndicator color={theme.colors.textSecondary} accessibilityLabel="Loading video" />
      </View>
    );
  }
  return <ResolvedPlayer key={JSON.stringify(source)} source={source} style={style} />;
}

const styles = themedStyles(() => StyleSheet.create({
  video: {
    backgroundColor: "#000000",
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: theme.colors.surface,
  },
  placeholderText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
}));
