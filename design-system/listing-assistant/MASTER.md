# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/listing-assistant/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** ListFlick
**Platform:** React Native (Expo) — iOS & Android mobile app
**Updated:** 2026-08-24
**Category:** Mobile utility — photo-to-listing workflow for casual marketplace sellers

---

## Design Philosophy

This is a **calm, practical, mobile-first utility app** — not a marketing site, dashboard, or chatbot.

- **Preview-first:** Every screen should prioritize the user's content (photos, title, price) over chrome.
- **Marketplace-native:** The listing preview should look like it belongs on Facebook Marketplace, not in an AI product.
- **Minimal intervention:** AI features exist to help, not to dominate. Guidance appears in the right place, not everywhere.
- **No web patterns:** No hero sections, search bars, hover states, cursor pointers, card carousels, or landing page CTAs. This is a native mobile app.

---

## Color Palette

Strict, high-contrast, light-mode-first monochrome palette. No gradients. No tinted backgrounds.

| Role | Token | Hex | Usage |
|------|-------|-----|-------|
| Background | `background` | `#FFFFFF` | Primary app background |
| Surface | `surface` | `#F5F5F5` | Cards, trays, input field backgrounds |
| Surface Elevated | `surfaceElevated` | `#FFFFFF` | Elements sitting inside a surface |
| Border | `border` | `#E5E5E5` | Inputs, dividers, card outlines |
| Border Subtle | `borderSubtle` | `#EEEEEE` | List row separators |
| Text Primary | `textPrimary` | `#1A1A1A` | Headings, body, active icons |
| Text Secondary | `textSecondary` | `#6B6B6B` | Subtitles, helper text, inactive tabs |
| Text Tertiary | `textTertiary` | `#999999` | Placeholders, disabled states |
| Text Link | `textLink` | `#1A1A1A` | Tappable text (no underline on mobile) |
| Accent | `accent` | `#1A1A1A` | Primary action buttons, selected states |
| Accent Text | `accentText` | `#FFFFFF` | Text inside primary buttons |
| Tag Background | `tagBackground` | `#F0F0F0` | Non-interactive badges/pills |
| Tag Border | `tagBorder` | `#E0E0E0` | Badge/pill outlines |
| Success | `success` | `#22C55E` | Positive status ("Good photo", synced) |
| Warning | `warning` | `#F59E0B` | Warnings ("Missing detail", low confidence) |

**Notes:**
- Accent is intentionally `#1A1A1A` (near-black). Primary buttons are dark, not colorful.
- Success/Warning are the only chromatic colors in the palette.
- Never invent new colors. Use these tokens exclusively.

---

## Typography

System sans-serif fonts (SF Pro on iOS, Roboto on Android) to feel native and fast. No Google Fonts imports needed — this is React Native.

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| `heroTitle` | 28px | 800 (ExtraBold) | Top-level screen headers ("Home", "Settings") |
| `screenTitle` | 17px | 600 (SemiBold) | Stack navigation headers |
| `sectionLabel` | 12px | 600 (SemiBold) | Uppercase section headers (letterSpacing: 0.5) |
| `fieldLabel` | 13px | 500 (Medium) | Labels above input fields |
| `fieldValue` | 16px | 400 (Regular) | Input field text |
| `priceDisplay` | 24px | 700 (Bold) | Large price callouts |
| `priceStrikethrough` | 16px | 400 (Regular) | Strikethrough price comparison |
| `body` | 15px | 400 (Regular) | Standard body text (lineHeight: 22) |
| `caption` | 12px | 400 (Regular) | Small helper text |
| `buttonLabel` | 16px | 600 (SemiBold) | Button text |
| `chipLabel` | 13px | 500 (Medium) | Filter chips, status tags |
| `tabLabel` | 10px | 500 (Medium) | Bottom tab bar text |

---

## Spacing & Layout

Strict 4pt/8pt grid. No arbitrary margins.

| Token | Value | Usage |
|-------|-------|-------|
| `screenPadding` | 20px | Horizontal padding for all scroll views |
| `sectionGap` | 24px | Vertical gap between functional blocks |
| `fieldGap` | 16px | Vertical gap between form fields |
| `sm` | 8px | Icon-to-text gaps, small internal spacing |
| `xs` | 4px | Label-to-subtitle gaps, micro spacing |

---

## Border Radii

Slightly rounded, grounded. Never use circular pill shapes for primary actions.

| Token | Value | Usage |
|-------|-------|-------|
| `card` | 16px | Grouping containers, AI insight cards |
| `button` | 12px | Action buttons |
| `photo` | 12px | Image thumbnails, gallery items |
| `chip` | 20px | Filter chips, status badges |

---

## Component Patterns (React Native StyleSheet)

### Primary Button

```typescript
primaryButton: {
  backgroundColor: theme.colors.accent,        // #1A1A1A
  borderRadius: theme.radius.button,            // 12
  paddingVertical: 16,
  alignItems: "center",
},
primaryButtonText: {
  ...theme.typography.buttonLabel,              // 16px, 600
  color: theme.colors.accentText,              // #FFFFFF
},
```

### Surface Card

```typescript
card: {
  backgroundColor: theme.colors.surface,        // #F5F5F5
  borderRadius: theme.radius.card,              // 16
  padding: theme.spacing.screenPadding,         // 20
  // NO box-shadow. Use borderWidth: 1, borderColor: theme.colors.borderSubtle
},
```

### Text Input

```typescript
input: {
  backgroundColor: theme.colors.surface,        // #F5F5F5
  borderRadius: theme.radius.button,            // 12
  paddingHorizontal: 16,
  paddingVertical: 14,
  fontSize: 16,
  color: theme.colors.textPrimary,             // #1A1A1A
  // Border only on focus state, not default
},
```

### Section Header

```typescript
sectionHeader: {
  ...theme.typography.sectionLabel,             // 12px, 600, uppercase
  color: theme.colors.textSecondary,           // #6B6B6B
  marginBottom: theme.spacing.sm,              // 8
},
```

---

## Screen Architecture

The app flow is a sequential workflow, not a browsable directory.

| Screen | Purpose | Navigation |
|--------|---------|------------|
| **Home** | Entry point — "Take photo" / "Choose from library" | Tab bar |
| **Camera** | Photo capture | Full-screen, hides tab bar |
| **Processing** | AI analysis spinner | Full-screen, hides tab bar |
| **Review Listing** | Clean listing preview with save/share actions | Stack push from Processing |
| **Edit Listing** | Form workspace for title, price, description, details | Stack push from Review |
| **Manage Photos** | Photo grid — reorder, remove, add, quality feedback | Stack push from Review |
| **Inventory** | Saved listings list | Tab bar |
| **Settings** | Profile, AI Insights toggle, defaults | Tab bar |

---

## AI Insights Layering

AI features are gated behind a Settings toggle. When enabled:

| Screen | What appears |
|--------|-------------|
| Review Listing | Small edit shortcuts (tap to jump to Edit Listing) |
| Edit Listing | Missing-info checklist, listing quality score, AI rewrite actions |
| Manage Photos | Per-photo quality feedback badges (good / needs improvement / poor) |

When disabled, all screens remain fully functional for manual listing creation.

---

## Anti-Patterns (Do NOT Use)

### Visual
- ❌ Glassmorphism, frosted glass, or semi-transparent overlays
- ❌ Gradients (linear, radial, or conic)
- ❌ Drop shadows for elevation — use 1px borders instead
- ❌ Oversized border radii (no pill-shaped primary buttons)
- ❌ Decorative illustrations or mascots
- ❌ Emoji as icons — use `Ionicons` from `@expo/vector-icons`

### Structural
- ❌ Hero sections, splash banners, or marketing CTAs
- ❌ Card carousels or horizontal scroll galleries
- ❌ Search bars as primary actions
- ❌ Hover states or cursor:pointer (this is mobile, not web)
- ❌ CSS media queries or responsive breakpoints (React Native handles this)
- ❌ Cards inside cards (no nested elevation)

### Behavioral
- ❌ Auto-triggering AI calls when a screen opens
- ❌ Showing all AI insights on the listing preview
- ❌ Blocking the user from proceeding without AI guidance

---

## Brand Identity & Monogram

The official ListFlick monogram is an aerodynamic, forward-slanted `LF` mark combining a sweeping upper wing with a detached floating crossbar for crisp legibility across small icon sizes.

- **Vector Master:** `design-system/listing-assistant/listflick-mark.svg`
- **In-App Component:** `mobile/components/brand/ListFlickMark.tsx` (`<ListFlickMark size={...} />`)
- **Master Platform Assets:** `mobile/assets/images/icon.png` and `splash.png` (1024×1024, `#FFFFFF` background, `#161616` glyph)
- **Native Splash Assets:** `mobile/android/app/src/main/res/drawable-*/splashscreen_logo.png` and `mobile/ios/ListingAssistant/Images.xcassets/SplashScreenLogo.imageset/`, centered by each platform's launch-screen configuration.
- **Processing Loader:** `mobile/app/processing.tsx` uses the animated `<ListFlickMark />` instead of a sparkle glyph.
- **App Icon Colorway:** Light-mode primary (`#FFFFFF` background, near-black glyph) to match the light-mode-first mobile utility philosophy.

---

## Implementation Rules

1. **Always import `theme`** from `mobile/constants/theme.ts`. Never hardcode hex values.
2. **Icons:** `@expo/vector-icons` (`Ionicons`). Size 20–24px. Use `-outline` for inactive, solid for active.
3. **Grouped lists:** Use `surface` card (radius 16) with rows separated by `hairlineWidth` + `border` color.
4. **Bottom tabs:** 3 tabs — Home, Inventory, Settings. Hidden during Camera and Processing flows.
5. **Safe areas:** Always use `useSafeAreaInsets()` for header/footer spacing.

---

## Pre-Delivery Checklist

Before delivering any mobile UI code:

- [ ] All colors use `theme.colors.*` tokens, no hardcoded hex
- [ ] All text styles use `theme.typography.*` tokens
- [ ] All spacing uses `theme.spacing.*` tokens
- [ ] All radii use `theme.radius.*` tokens
- [ ] Icons from `Ionicons`, no emoji
- [ ] No web-specific patterns (hover, cursor, CSS imports, breakpoints)
- [ ] Safe area insets applied to headers and bottom bars
- [ ] New hook/utility imports verified in every edited file
- [ ] Screen renders without crash after Metro rebundle
