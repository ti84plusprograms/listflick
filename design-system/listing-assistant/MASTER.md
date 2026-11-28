# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/listing-assistant/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** ListFlick
**Platform:** React Native (Expo) — iOS & Android mobile app
**Updated:** 2026-11-28
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

Strict, high-contrast monochrome palette with a light and a dark scheme. No
gradients. No tinted backgrounds. Light is the default; Settings > Appearance
switches to Dark. Dark swaps the palette: light surfaces go dark, and dark text
and accents go light. Both palettes live in `mobile/constants/theme.ts` and
share the same token names.

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Background | `background` | `#FFFFFF` | `#121212` | Primary app background |
| Surface | `surface` | `#F5F5F5` | `#1E1E1E` | Cards, trays, input field backgrounds |
| Surface Elevated | `surfaceElevated` | `#FFFFFF` | `#242424` | Elements sitting inside a surface |
| Border | `border` | `#E5E5E5` | `#333333` | Inputs, dividers, card outlines |
| Border Subtle | `borderSubtle` | `#EEEEEE` | `#2A2A2A` | List row separators |
| Text Primary | `textPrimary` | `#1A1A1A` | `#F2F2F2` | Headings, body, active icons |
| Text Secondary | `textSecondary` | `#6B6B6B` | `#A3A3A3` | Subtitles, helper text |
| Text Tertiary | `textTertiary` | `#999999` | `#737373` | Placeholders, disabled states |
| Text Link | `textLink` | `#1A1A1A` | `#F2F2F2` | Tappable text (no underline on mobile) |
| Accent | `accent` | `#1A1A1A` | `#F2F2F2` | Primary action buttons, selected states |
| Accent Text | `accentText` | `#FFFFFF` | `#121212` | Text inside primary buttons |
| Tag Background | `tagBackground` | `#F0F0F0` | `#2A2A2A` | Non-interactive badges/pills |
| Tag Border | `tagBorder` | `#E0E0E0` | `#3A3A3A` | Badge/pill outlines |
| Success | `success` | `#22C55E` | `#22C55E` | Positive status ("Good photo", synced) |
| Warning | `warning` | `#F59E0B` | `#F59E0B` | Warnings ("Missing detail", low confidence) |
| Tab Active | `tabActive` | `#1A1A1A` | `#F2F2F2` | Selected bottom tab |
| Tab Inactive | `tabInactive` | `#999999` | `#737373` | Unselected bottom tabs |
| Overlay Bar | `overlayBar` | `rgba(255,255,255,0.94)` | `rgba(18,18,18,0.94)` | Translucent bars over photos |
| Grabber | `grabber` | `rgba(26,26,26,0.24)` | `rgba(242,242,242,0.24)` | Sheet grabber handle |
| Accent Tint | `accentTint` | `rgba(255,255,255,0.14)` | `rgba(0,0,0,0.08)` | Chips sitting on the accent color |
| Switch Thumb | `switchThumb` | `#FFFFFF` | `#121212` | Switch knob (dark mode needs a dark knob on the light "on" track) |

**Notes:**
- Accent is near-black in light mode and near-white in dark mode. Primary buttons are high-contrast, not colorful.
- Success/Warning are the only chromatic colors in the palette, and they are the same in both schemes.
- Never invent new colors. Use these tokens exclusively, and add any new token to both palettes (`ThemeColors` requires it).

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

Colors in the snippets below show the light value; dark mode resolves the same
token to its dark value through `themedStyles` (see Theming).

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

## Theming

`theme.colors` is a getter that returns the palette for the active scheme
(`getActiveColorScheme()`, `setActiveColorScheme()`, `colorsFor(scheme)`). Because a
plain `StyleSheet.create` would read the palette only once at import time, wrap
every module-level stylesheet in `themedStyles` so it is rebuilt once per scheme:

```typescript
import { theme, themedStyles } from "../constants/theme";

const styles = themedStyles(() =>
  StyleSheet.create({
    card: { backgroundColor: theme.colors.surface },
  })
);
```

`styles.card` then returns the style for the active scheme. The app redraws its
screens when Appearance changes, and native alerts and the status bar follow the
choice. Do not read `theme.colors` into a module-level constant outside
`themedStyles`, or it will stay on the scheme that was active at import.

---

## Screen Architecture

The app flow is a sequential workflow, not a browsable directory.

| Screen | Purpose | Navigation |
|--------|---------|------------|
| **Home** | Entry point — "Make your first listing" or "New listing", then a **Needs attention** list (unfinished listings first) and **Ready to post** | Tab bar |
| **Camera** | Photo or video capture, and the Library button | Full-screen, hides tab bar |
| **Processing** | AI analysis spinner | Full-screen, hides tab bar |
| **Review Listing** | Clean listing preview with save/share actions | Stack push from Processing |
| **Edit Listing** | Form workspace for title, price, description, details | Stack push from Review |
| **Manage Photos** | Photo grid — reorder, remove, add, quality feedback; one optional video | Stack push from Review |
| **Inventory** | Saved listings list | Tab bar |
| **Settings** | Profile, AI Insights toggle, defaults | Tab bar |

---

## AI Insights Layering

AI features are gated behind a Settings toggle. When enabled:

| Screen | What appears |
|--------|-------------|
| Review Listing | Small edit shortcuts (tap to jump to Edit Listing) |
| Edit Listing | Missing-info checklist, listing quality score, **Improve with AI** rewrite chips |
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
- **Native Splash Assets:** generated by `npx expo prebuild` from the `expo-splash-screen` plugin in `mobile/app.json` (`assets/images/logo-mark.png`, 200pt wide, centered on `#FFFFFF`).
- **Processing Loader:** `mobile/app/processing.tsx` uses the animated `<ListFlickMark />` instead of a sparkle glyph.
- **Dark Variants:** `mobile/assets/images/icon-dark.png` (iOS dark icon, `ios.icon.dark` in `mobile/app.json`) and `logo-mark-dark.png` (dark splash on `#121212`, the `dark` option of the `expo-splash-screen` plugin). In app, `<ListFlickMark />` follows the active scheme.
- **App Icon Colorway:** Light variant is `#FFFFFF` background with a near-black glyph; the dark variant is `icon-dark.png`.

---

## Implementation Rules

1. **Always import `theme`** from `mobile/constants/theme.ts`. Never hardcode hex values. Wrap module-level `StyleSheet.create` in `themedStyles` (see Theming).
2. **Icons:** `@expo/vector-icons` (`Ionicons`). Size 20–24px. Use `-outline` for inactive, solid for active.
3. **Grouped lists:** Use `surface` card (radius 16) with rows separated by `hairlineWidth` + `border` color.
4. **Bottom tabs:** 3 tabs — Home, Inventory, Settings. Hidden during Camera and Processing flows.
5. **Safe areas:** Always use `useSafeAreaInsets()` for header/footer spacing.

---

## Pre-Delivery Checklist

Before delivering any mobile UI code:

- [ ] All colors use `theme.colors.*` tokens, no hardcoded hex
- [ ] Module-level styles are wrapped in `themedStyles` and checked in light and dark mode
- [ ] All text styles use `theme.typography.*` tokens
- [ ] All spacing uses `theme.spacing.*` tokens
- [ ] All radii use `theme.radius.*` tokens
- [ ] Icons from `Ionicons`, no emoji
- [ ] No web-specific patterns (hover, cursor, CSS imports, breakpoints)
- [ ] Safe area insets applied to headers and bottom bars
- [ ] New hook/utility imports verified in every edited file
- [ ] Screen renders without crash after Metro rebundle
