import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme, themedStyles } from "../../constants/theme";
import {
  QUESTIONS_CARD_TITLE,
  questionDraft,
  type ListingQuestion,
  type QuestionDrafts,
} from "../../utils/listingQuestions";

interface ListingQuestionsCardProps {
  questions: ListingQuestion[];
  drafts: QuestionDrafts;
  /** Label shown on the primary button while the update runs; null when idle. */
  busyLabel: string | null;
  canSubmit: boolean;
  onToggleOption: (questionId: string, option: string) => void;
  onChangeText: (questionId: string, text: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
}

export function ListingQuestionsCard({
  questions,
  drafts,
  busyLabel,
  canSubmit,
  onToggleOption,
  onChangeText,
  onSubmit,
  onSkip,
}: ListingQuestionsCardProps) {
  if (questions.length === 0) return null;
  const busy = busyLabel !== null;

  return (
    <View style={styles.card} accessibilityLabel={QUESTIONS_CARD_TITLE}>
      <Text style={styles.cardTitle} accessibilityRole="header">
        {QUESTIONS_CARD_TITLE}
      </Text>

      {questions.map((question) => {
        const draft = questionDraft(drafts, question.id);
        return (
          <View key={question.id} style={styles.questionBlock}>
            <View style={styles.questionHeader}>
              <Text style={styles.questionText}>{question.question}</Text>
              {question.affectsPrice && (
                <View style={styles.priceTag} accessibilityLabel="Affects price">
                  <Ionicons name="pricetag-outline" size={12} color={theme.colors.textSecondary} />
                  <Text style={styles.priceTagText}>Affects price</Text>
                </View>
              )}
            </View>
            {question.why ? <Text style={styles.whyText}>{question.why}</Text> : null}

            {question.options.length > 0 && (
              <View style={styles.optionsRow}>
                {question.options.map((option) => {
                  const selected = draft.selected === option;
                  return (
                    <Pressable
                      key={option}
                      style={[styles.optionChip, selected && styles.optionChipSelected]}
                      onPress={() => onToggleOption(question.id, option)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: busy }}
                      accessibilityLabel={`${question.question} ${option}`}
                    >
                      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <TextInput
              style={styles.answerInput}
              value={draft.text}
              onChangeText={(text) => onChangeText(question.id, text)}
              placeholder={question.options.length > 0 ? "Or type your answer" : "Type your answer"}
              placeholderTextColor={theme.colors.textTertiary}
              editable={!busy}
              accessibilityLabel={`Answer: ${question.question}`}
              returnKeyType="done"
            />
          </View>
        );
      })}

      <Pressable
        style={[styles.updateButton, (!canSubmit || busy) && styles.updateButtonDisabled]}
        onPress={onSubmit}
        disabled={!canSubmit || busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit || busy, busy }}
        accessibilityLabel={busyLabel ?? "Update Listing"}
      >
        {busy && <ActivityIndicator size="small" color={theme.colors.accentText} />}
        <Text style={styles.updateButtonText} accessibilityLiveRegion="polite">
          {busyLabel ?? "Update Listing"}
        </Text>
      </Pressable>

      <Pressable
        onPress={onSkip}
        disabled={busy}
        style={styles.skipButton}
        accessibilityRole="link"
        accessibilityLabel="Skip these questions for now"
      >
        <Text style={[styles.skipText, busy && styles.skipTextDisabled]}>Skip for now</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  card: {
    marginBottom: 20,
    padding: 16,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    gap: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.textPrimary,
  },
  questionBlock: {
    gap: 8,
  },
  questionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  questionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  priceTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.chip,
    borderWidth: 1,
    borderColor: theme.colors.tagBorder,
    backgroundColor: theme.colors.tagBackground,
  },
  priceTagText: {
    ...theme.typography.caption,
    fontWeight: "600",
    color: theme.colors.textSecondary,
  },
  whyText: {
    ...theme.typography.caption,
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  optionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.chip,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  optionChipSelected: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  optionText: {
    ...theme.typography.chipLabel,
    color: theme.colors.textPrimary,
  },
  optionTextSelected: {
    color: theme.colors.accentText,
  },
  answerInput: {
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    borderRadius: theme.radius.photo,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.colors.textPrimary,
    backgroundColor: theme.colors.background,
  },
  updateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    borderRadius: theme.radius.button,
  },
  updateButtonDisabled: {
    opacity: 0.5,
  },
  updateButtonText: {
    ...theme.typography.buttonLabel,
    color: theme.colors.accentText,
  },
  skipButton: {
    alignSelf: "center",
    paddingVertical: 4,
  },
  skipText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.textSecondary,
    textDecorationLine: "underline",
  },
  skipTextDisabled: {
    color: theme.colors.textTertiary,
  },
}));
