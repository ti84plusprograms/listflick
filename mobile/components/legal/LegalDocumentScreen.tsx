import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Fragment, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "../../constants/theme";
import { parseLegalMarkdown, type LegalBlock } from "../../utils/legalContent";

function InlineText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <Text key={index} style={styles.strongText}>
            {part.slice(2, -2)}
          </Text>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function LegalBlockView({ block }: { block: LegalBlock }) {
  if (block.kind === "title") {
    return (
      <Text accessibilityRole="header" selectable style={styles.documentTitle}>
        <InlineText text={block.text} />
      </Text>
    );
  }
  if (block.kind === "heading") {
    return (
      <Text accessibilityRole="header" selectable style={styles.sectionHeading}>
        <InlineText text={block.text} />
      </Text>
    );
  }
  if (block.kind === "list-item") {
    return (
      <View style={styles.listRow}>
        <Text accessibilityElementsHidden style={styles.listMarker}>
          {block.ordered ? `${block.index}.` : "•"}
        </Text>
        <Text selectable style={styles.bodyText}>
          <InlineText text={block.text} />
        </Text>
      </View>
    );
  }
  return (
    <Text selectable style={styles.bodyText}>
      <InlineText text={block.text} />
    </Text>
  );
}

export function LegalDocumentScreen({ markdown, screenTitle }: { markdown: string; screenTitle: string }) {
  const insets = useSafeAreaInsets();
  const blocks = useMemo(() => parseLegalMarkdown(markdown), [markdown]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back to Settings"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.headerTitle}>
          {screenTitle}
        </Text>
        <View accessibilityElementsHidden style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}
        showsVerticalScrollIndicator={false}
      >
        {blocks.map((block, index) => (
          <LegalBlockView block={block} key={`${block.kind}-${index}`} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    minHeight: 56,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  backButton: {
    width: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
  },
  pressed: {
    backgroundColor: theme.colors.surface,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: theme.colors.textPrimary,
    ...theme.typography.screenTitle,
  },
  headerSpacer: {
    width: 48,
  },
  content: {
    paddingHorizontal: theme.spacing.screenPadding,
    paddingTop: 24,
    gap: 14,
  },
  documentTitle: {
    color: theme.colors.textPrimary,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 34,
    marginBottom: 2,
  },
  sectionHeading: {
    color: theme.colors.textPrimary,
    fontSize: 19,
    fontWeight: "700",
    lineHeight: 26,
    marginTop: 14,
  },
  bodyText: {
    flexShrink: 1,
    color: theme.colors.textSecondary,
    fontSize: 16,
    lineHeight: 25,
  },
  strongText: {
    color: theme.colors.textPrimary,
    fontWeight: "700",
  },
  listRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingLeft: 4,
  },
  listMarker: {
    minWidth: 14,
    color: theme.colors.textPrimary,
    fontSize: 16,
    lineHeight: 25,
    fontWeight: "700",
  },
});
