import { router } from "expo-router";
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Switch, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useEditListingForm } from "../hooks/useEditListingForm";
import { CONDITION_OPTIONS } from "../utils/descriptionFormatter";
import { theme } from "../constants/theme";
import { PricingTiers } from "../components/listing/PricingTiers";
import { Logistics } from "../components/listing/Logistics";

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
    brandHint,
    detailsHint,
    applyPriceTier,
    runImprovement,
    saveEdits,
  } = useEditListingForm();

  return (
    <View style={styles.container} testID="edit-listing-screen">
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
          <Text style={styles.headerButtonText}>Preview</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Edit Listing</Text>
        <Pressable
          onPress={saveEdits}
          style={styles.headerButtonRight}
          testID="edit-listing-save"
          accessibilityLabel="Save listing edits"
        >
          <Text style={styles.saveText}>Save</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardDismissMode="on-drag">

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput
              style={styles.input}
              testID="edit-listing-title"
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
                testID="edit-listing-price"
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
              testID="edit-listing-brand-model"
              accessibilityLabel="Brand and model"
              value={brandModel}
              onChangeText={setBrandModel}
              placeholder="e.g. Herman Miller Aeron"
              placeholderTextColor={theme.colors.textTertiary}
            />

            {improvementSummary ? (
              <Text
                style={styles.improvementSummary}
                testID="edit-listing-improvement-summary"
                accessibilityLiveRegion="polite"
              >
                {improvementSummary}
              </Text>
            ) : null}

            {brandHint && (
              <View style={styles.hintCard} testID="edit-listing-buyer-trust-suggestion">
                <View style={styles.hintRow}>
                  <Ionicons name="sparkles-outline" size={16} color={theme.colors.textSecondary} />
                  <Text style={styles.hintText}>{brandHint.reason || "Missing brand or model details."}</Text>
                </View>
                <Pressable
                  testID="edit-listing-apply-buyer-trust"
                  accessibilityLabel="Apply buyer trust suggestion"
                  disabled={improving}
                  onPress={() => runImprovement("improve_buyer_trust")}
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
              <View style={styles.hintCard} testID="edit-listing-description-suggestion">
                <View style={styles.hintRow}>
                  <Ionicons name="bulb-outline" size={16} color={theme.colors.textSecondary} />
                  <Text style={styles.hintText}>{detailsHint.reason || "Add more details for buyers."}</Text>
                </View>
                <Pressable
                  testID="edit-listing-apply-description-details"
                  accessibilityLabel="Apply description details suggestion"
                  disabled={improving}
                  onPress={() => runImprovement("add_condition_details")}
                >
                  <Text style={styles.hintActionText} accessibilityLiveRegion="polite">
                    {improving ? "Applying..." : "Apply suggestion"}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

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

const styles = StyleSheet.create({
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
});
