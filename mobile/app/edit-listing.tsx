import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Switch, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useEditListingForm } from "../hooks/useEditListingForm";
import { CONDITION_OPTIONS } from "../utils/descriptionFormatter";
import { theme, themedStyles } from "../constants/theme";
import { PricingTiers } from "../components/listing/PricingTiers";
import { Logistics } from "../components/listing/Logistics";
import type { ImprovementAction } from "../types/listing";

// Every rewrite the backend supports, matching the web version's Edit screen.
const IMPROVE_ACTIONS: [ImprovementAction, string][] = [
  ["make_title_more_searchable", "More searchable title"],
  ["make_description_shorter", "Shorter description"],
  ["make_description_more_casual", "More casual"],
  ["make_description_more_professional", "More professional"],
  ["add_condition_details", "Add condition details"],
  ["improve_buyer_trust", "Build buyer trust"],
  ["make_price_more_competitive", "More competitive price"],
  ["generate_platform_ready_version", "Marketplace-ready polish"],
];

export default function EditListingScreen() {
  const insets = useSafeAreaInsets();
  const [conditionMenuOpen, setConditionMenuOpen] = useState(false);
  const [descriptionEditorOpen, setDescriptionEditorOpen] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const {
    title,
    setTitle,
    priceInput,
    setPriceInput,
    description,
    setDescription,
    category,
    setCategory,
    condition,
    setCondition,
    negotiable,
    setNegotiable,
    brandModel,
    setBrandModel,
    dimensions,
    setDimensions,
    flaws,
    setFlaws,
    accessories,
    setAccessories,
    localPickup,
    setLocalPickup,
    shipping,
    setShipping,
    activePriceSource,
    pricing,
    insightsEnabled,
    improving,
    improvementSummary,
    improvingAction,
    improveSummary,
    repricingLabel,
    brandHint,
    detailsHint,
    applyPriceTier,
    runImprovement,
    saveEdits,
  } = useEditListingForm();

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={[styles.headerButton, repricingLabel !== null && styles.headerButtonDisabled]}
          disabled={repricingLabel !== null}
          accessibilityRole="button"
          accessibilityLabel="Back to preview"
          accessibilityState={{ disabled: repricingLabel !== null }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
          <Text style={styles.headerButtonText}>Preview</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Edit Listing</Text>
        <Pressable
          onPress={saveEdits}
          style={styles.headerButtonRight}
          disabled={repricingLabel !== null}
          accessibilityRole="button"
          accessibilityLabel={repricingLabel ?? "Save listing edits"}
        >
          <Text style={[styles.saveText, repricingLabel !== null && styles.saveTextBusy]}>
            {repricingLabel ? "Saving…" : "Save"}
          </Text>
        </Pressable>
      </View>
      {repricingLabel && (
        <View style={styles.repricingBanner} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
          <Text style={styles.repricingText}>{repricingLabel}</Text>
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardDismissMode="on-drag">

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Listing title"
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Herman Miller Aeron Chair — Size B"
              placeholderTextColor={theme.colors.textTertiary}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Price</Text>
            <View style={styles.priceInputWrapper}>
              <Text style={styles.currencySymbol}>$</Text>
              <TextInput
                style={styles.priceInput}
                accessibilityLabel="Listing price"
                value={priceInput}
                onChangeText={setPriceInput}
                keyboardType="decimal-pad"
                placeholder="485"
                placeholderTextColor={theme.colors.textTertiary}
              />
              <Pressable
                style={[styles.negotiablePill, negotiable && styles.negotiablePillActive]}
                onPress={() => setNegotiable(!negotiable)}
              >
                <Text style={[styles.negotiablePillText, negotiable && styles.negotiablePillTextActive]}>
                  {negotiable ? "Negotiable" : "Firm"}
                </Text>
              </Pressable>
            </View>
          </View>

          {insightsEnabled && pricing && (
            <PricingTiers
              pricing={pricing}
              activePriceSource={activePriceSource}
              applyPriceTier={applyPriceTier}
            />
          )}

          {/* SECTION: CONDITION */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionLine} />
            <Text style={styles.sectionTitle}>CONDITION</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Condition</Text>
            <Pressable
              style={styles.conditionSelect}
              onPress={() => setConditionMenuOpen((open) => !open)}
            >
              <Text style={styles.conditionSelectText}>{condition}</Text>
              <Ionicons
                name={conditionMenuOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color={theme.colors.textSecondary}
              />
            </Pressable>
            {conditionMenuOpen && (
              <View style={styles.conditionMenu}>
                {CONDITION_OPTIONS.map((option) => (
                  <Pressable
                    key={option}
                    style={styles.conditionOption}
                    onPress={() => {
                      setCondition(option);
                      setConditionMenuOpen(false);
                    }}
                  >
                    <Text style={styles.conditionOptionText}>{option}</Text>
                    {condition === option && (
                      <Ionicons name="checkmark" size={18} color={theme.colors.textPrimary} />
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Flaws</Text>
            <TextInput
              style={[styles.input, { minHeight: 80, paddingTop: 14 }]}
              value={flaws}
              onChangeText={setFlaws}
              placeholder="e.g. Minor wear on armrests"
              placeholderTextColor={theme.colors.textTertiary}
              multiline={true}
              textAlignVertical="top"
            />
          </View>

          {/* SECTION: ITEM DETAILS */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionLine} />
            <Text style={styles.sectionTitle}>ITEM DETAILS</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Category</Text>
            <TextInput style={styles.input} value={category} onChangeText={setCategory} />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Brand / Model</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Brand and model"
              value={brandModel}
              onChangeText={setBrandModel}
              placeholder="e.g. Herman Miller Aeron"
              placeholderTextColor={theme.colors.textTertiary}
            />

            {improvementSummary ? (
              <Text
                style={styles.improvementSummary}
                accessibilityLiveRegion="polite"
              >
                {improvementSummary}
              </Text>
            ) : null}

            {brandHint && (
              <View style={styles.hintCard}>
                <View style={styles.hintRow}>
                  <Ionicons name="sparkles-outline" size={16} color={theme.colors.textSecondary} />
                  <Text style={styles.hintText}>{brandHint.reason || "Missing brand or model details."}</Text>
                </View>
                <Pressable
                  accessibilityLabel="Apply buyer trust suggestion"
                  disabled={improving}
                  onPress={() => runImprovement("improve_buyer_trust", "", "suggestion")}
                >
                  <Text style={styles.hintActionText} accessibilityLiveRegion="polite">
                    {improving ? "Applying..." : "Apply suggestion"}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Dimensions</Text>
            <TextInput style={styles.input} value={dimensions} onChangeText={setDimensions} placeholder="e.g. 27 x 27 x 41 in" placeholderTextColor={theme.colors.textTertiary} />
          </View>


          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Accessories</Text>
            <TextInput style={styles.input} value={accessories} onChangeText={setAccessories} placeholder="e.g. Original manual" placeholderTextColor={theme.colors.textTertiary} />
          </View>


          {/* SECTION: DESCRIPTION */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionLine} />
            <Text style={styles.sectionTitle}>DESCRIPTION</Text>
          </View>

          <View style={styles.field}>
            <Pressable
              style={styles.descriptionPreviewBox}
              onPress={() => { setDescriptionDraft(description); setDescriptionEditorOpen(true); }}
            >
              <View style={styles.descriptionEditIconContainer}>
                <Ionicons name="pencil" size={14} color={theme.colors.textTertiary} />
              </View>
              <Text style={styles.descriptionPreviewText} selectable={false}>
                {description}
              </Text>
            </Pressable>
            {detailsHint && (
              <View style={styles.hintCard}>
                <View style={styles.hintRow}>
                  <Ionicons name="bulb-outline" size={16} color={theme.colors.textSecondary} />
                  <Text style={styles.hintText}>{detailsHint.reason || "Add more details for buyers."}</Text>
                </View>
                <Pressable
                  accessibilityLabel="Apply description details suggestion"
                  disabled={improving}
                  onPress={() => runImprovement("add_condition_details", "", "suggestion")}
                >
                  <Text style={styles.hintActionText} accessibilityLiveRegion="polite">
                    {improving ? "Applying..." : "Apply suggestion"}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {insightsEnabled && (
            <>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionLine} />
                <Text style={styles.sectionTitle}>IMPROVE WITH AI</Text>
              </View>
              {improveSummary && (
                <Text style={styles.improveSummary} accessibilityLiveRegion="polite">
                  {improveSummary}
                </Text>
              )}
              <View style={styles.improveChips}>
                {IMPROVE_ACTIONS.map(([action, label]) => {
                  const busy = improvingAction === action;
                  return (
                    <Pressable
                      key={action}
                      style={[styles.improveChip, improving && !busy && styles.improveChipDisabled]}
                      onPress={() => runImprovement(action)}
                      disabled={improving}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      accessibilityState={{ disabled: improving, busy }}
                    >
                      <Ionicons
                        name={busy ? "refresh" : "sparkles-outline"}
                        size={14}
                        color={theme.colors.textPrimary}
                      />
                      <Text style={styles.improveChipText}>{busy ? "Working…" : label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* SECTION: LOGISTICS */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionLine} />
            <Text style={styles.sectionTitle}>LOGISTICS</Text>
          </View>

          <Logistics
            localPickup={localPickup}
            setLocalPickup={setLocalPickup}
            shipping={shipping}
            setShipping={setShipping}
          />

        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={descriptionEditorOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setDescriptionEditorOpen(false)}
      >
        <View style={styles.descriptionModal}>
          <View style={[styles.descriptionModalHeader, { paddingTop: insets.top + 12 }]}>
            <Pressable onPress={() => { setDescription(descriptionDraft); setDescriptionEditorOpen(false); }} style={styles.descriptionModalButton}>
              <Text style={styles.descriptionDoneText}>Done</Text>
            </Pressable>
            <Text style={styles.descriptionModalTitle}>Description</Text>
            <View style={styles.descriptionModalButton} />
          </View>

          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.descriptionEditorWrap}>
            <TextInput
              style={[styles.descriptionEditorInput, { paddingBottom: insets.bottom + 20 }]}
              value={descriptionDraft}
              onChangeText={setDescriptionDraft}
              multiline
              scrollEnabled
              textAlignVertical="top"
              autoFocus
            />
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.background,
  },
  headerButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    width: 100,
  },
  headerButtonDisabled: {
    opacity: 0.4,
  },
  headerButtonText: {
    fontSize: 15,
    color: theme.colors.textSecondary,
    marginLeft: 4,
  },
  headerTitle: {
    ...theme.typography.screenTitle,
    flex: 1,
    textAlign: "center",
  },
  headerButtonRight: {
    paddingHorizontal: 16,
    width: 100,
    alignItems: "flex-end",
  },
  saveText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  saveTextBusy: {
    color: theme.colors.textTertiary,
  },
  repricingBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surface,
  },
  repricingText: {
    ...theme.typography.caption,
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  scrollContent: {
    padding: theme.spacing.screenPadding,
    paddingBottom: 40,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 24,
    marginBottom: 16,
  },
  sectionTitle: {
    ...theme.typography.sectionLabel,
    color: theme.colors.textSecondary,
    marginLeft: 12,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.borderSubtle,
  },
  field: {
    marginBottom: theme.spacing.fieldGap,
  },
  fieldLabel: {
    ...theme.typography.fieldLabel,
    color: theme.colors.textPrimary,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    borderRadius: theme.radius.photo,
    padding: 14,
    fontSize: 15,
    color: theme.colors.textPrimary,
    backgroundColor: theme.colors.background,
  },
  improvementSummary: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: theme.colors.textSecondary,
  },
  descriptionPreviewBox: {
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    borderRadius: theme.radius.photo,
    padding: 14,
    paddingTop: 18,
    minHeight: 190,
    backgroundColor: theme.colors.surface,
    position: "relative",
  },
  descriptionEditIconContainer: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 1,
  },
  descriptionPreviewText: {
    fontSize: 15,
    lineHeight: 21,
    color: theme.colors.textPrimary,
  },
  descriptionModal: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  descriptionModalHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  descriptionModalButton: {
    width: 80,
    paddingHorizontal: 16,
  },
  descriptionDoneText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  descriptionModalTitle: {
    ...theme.typography.screenTitle,
    flex: 1,
    textAlign: "center",
  },
  descriptionEditorWrap: {
    flex: 1,
  },
  descriptionEditorInput: {
    flex: 1,
    padding: theme.spacing.screenPadding,
    fontSize: 16,
    lineHeight: 23,
    color: theme.colors.textPrimary,
    backgroundColor: theme.colors.background,
  },
  priceInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    borderRadius: theme.radius.photo,
    paddingHorizontal: 14,
    backgroundColor: theme.colors.background,
  },
  currencySymbol: {
    fontSize: 16,
    color: theme.colors.textTertiary,
    marginRight: 8,
  },
  priceInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
  negotiablePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    marginLeft: 8,
  },
  negotiablePillActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  negotiablePillText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.textSecondary,
    textTransform: "uppercase",
  },
  negotiablePillTextActive: {
    color: theme.colors.accentText,
  },

  conditionSelect: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    borderRadius: theme.radius.photo,
    backgroundColor: theme.colors.background,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  conditionSelectText: {
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
  conditionMenu: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    borderRadius: theme.radius.photo,
    backgroundColor: theme.colors.background,
    overflow: "hidden",
  },
  conditionOption: {
    minHeight: 44,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  conditionOptionText: {
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
  improveSummary: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    color: theme.colors.textSecondary,
    marginBottom: 12,
  },
  improveChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  improveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
  },
  improveChipDisabled: {
    opacity: 0.4,
  },
  improveChipText: {
    fontSize: 13,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },
  hintCard: {
    marginTop: 8,
    backgroundColor: theme.colors.surface,
    padding: 16,
    borderRadius: theme.radius.photo,
  },
  hintRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  hintText: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.textSecondary,
    lineHeight: 18,
  },
  hintActionText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.textPrimary,
    marginLeft: 24, // align under text
  },
}));
