export type ColorScheme = "light" | "dark";

const lightColors = {
  background: "#FFFFFF",
  surface: "#F5F5F5",
  surfaceElevated: "#FFFFFF",
  border: "#E5E5E5",
  borderSubtle: "#EEEEEE",
  textPrimary: "#1A1A1A",
  textSecondary: "#6B6B6B",
  textTertiary: "#999999",
  textLink: "#1A1A1A",
  accent: "#1A1A1A",
  accentText: "#FFFFFF",
  tagBackground: "#F0F0F0",
  tagBorder: "#E0E0E0",
  success: "#22C55E",
  warning: "#F59E0B",
  tabActive: "#1A1A1A",
  tabInactive: "#999999",
  /** Translucent bars over photos. */
  overlayBar: "rgba(255,255,255,0.94)",
  /** Sheet grabber handle. */
  grabber: "rgba(26,26,26,0.24)",
  /** Chips sitting on the accent color. */
  accentTint: "rgba(255, 255, 255, 0.14)",
  /** Switch knob; dark mode needs a dark knob on the light "on" track. */
  switchThumb: "#FFFFFF",
};

export type ThemeColors = typeof lightColors;

/* Dark mode swaps the palette: light surfaces go dark and dark text and accents go light. */
const darkColors: ThemeColors = {
  background: "#121212",
  surface: "#1E1E1E",
  surfaceElevated: "#242424",
  border: "#333333",
  borderSubtle: "#2A2A2A",
  textPrimary: "#F2F2F2",
  textSecondary: "#A3A3A3",
  textTertiary: "#737373",
  textLink: "#F2F2F2",
  accent: "#F2F2F2",
  accentText: "#121212",
  tagBackground: "#2A2A2A",
  tagBorder: "#3A3A3A",
  success: "#22C55E",
  warning: "#F59E0B",
  tabActive: "#F2F2F2",
  tabInactive: "#737373",
  overlayBar: "rgba(18,18,18,0.94)",
  grabber: "rgba(242,242,242,0.24)",
  accentTint: "rgba(0, 0, 0, 0.08)",
  switchThumb: "#121212",
};

let activeScheme: ColorScheme = "light";

export function getActiveColorScheme(): ColorScheme {
  return activeScheme;
}

/** Switches the palette that `theme.colors` and themed styles read. Re-render the app afterwards. */
export function setActiveColorScheme(scheme: ColorScheme): void {
  activeScheme = scheme;
}

export function colorsFor(scheme: ColorScheme): ThemeColors {
  return scheme === "dark" ? darkColors : lightColors;
}

/**
 * Wraps a module-level `StyleSheet.create` so it is built once per color scheme.
 * Reading `styles.x` returns the style for the active scheme.
 */
export function themedStyles<T extends object>(factory: () => T): T {
  const cache: Partial<Record<ColorScheme, T>> = {};
  const current = (): T => (cache[activeScheme] ??= factory());
  return new Proxy({} as T, {
    get: (_target, key) => Reflect.get(current(), key),
    has: (_target, key) => Reflect.has(current(), key),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_target, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(current(), key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

export const theme = {
  get colors(): ThemeColors {
    return colorsFor(activeScheme);
  },
  typography: {
    heroTitle: { fontSize: 28, fontWeight: "800" as const },
    screenTitle: { fontSize: 17, fontWeight: "600" as const },
    sectionLabel: { fontSize: 12, fontWeight: "600" as const, textTransform: "uppercase" as const, letterSpacing: 0.5 },
    fieldLabel: { fontSize: 13, fontWeight: "500" as const },
    fieldValue: { fontSize: 16, fontWeight: "400" as const },
    priceDisplay: { fontSize: 24, fontWeight: "700" as const },
    priceStrikethrough: { fontSize: 16, fontWeight: "400" as const, textDecorationLine: "line-through" as const },
    body: { fontSize: 15, fontWeight: "400" as const, lineHeight: 22 },
    caption: { fontSize: 12, fontWeight: "400" as const },
    buttonLabel: { fontSize: 16, fontWeight: "600" as const },
    chipLabel: { fontSize: 13, fontWeight: "500" as const },
    tabLabel: { fontSize: 10, fontWeight: "500" as const },
  },
  spacing: {
    screenPadding: 20,
    sectionGap: 24,
    fieldGap: 16,
    sm: 8,
    xs: 4,
  },
  radius: {
    card: 16,
    button: 12,
    chip: 20,
    photo: 12,
  }
};
