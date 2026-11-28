import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance } from "react-native";
import { setActiveColorScheme, type ColorScheme } from "../constants/theme";
import { getAppearance, saveAppearance } from "../services/storage";

interface AppearanceValue {
  scheme: ColorScheme;
  setScheme: (scheme: ColorScheme) => Promise<void>;
}

const AppearanceContext = createContext<AppearanceValue | null>(null);

function apply(scheme: ColorScheme) {
  setActiveColorScheme(scheme);
  // Native pieces (alerts, keyboard, pickers) follow the same choice.
  Appearance.setColorScheme(scheme);
}

/** Loads the saved Light/Dark choice before the app draws, so there is no flash of the other palette. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [scheme, setSchemeState] = useState<ColorScheme | null>(null);

  useEffect(() => {
    let active = true;
    getAppearance()
      .catch(() => "light" as const)
      .then((saved) => {
        if (!active) return;
        apply(saved);
        setSchemeState(saved);
      });
    return () => {
      active = false;
    };
  }, []);

  const setScheme = useCallback(async (next: ColorScheme) => {
    apply(next);
    setSchemeState(next);
    await saveAppearance(next);
  }, []);

  const value = useMemo(() => (scheme ? { scheme, setScheme } : null), [scheme, setScheme]);
  if (!value) return null;
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance must be used inside AppearanceProvider");
  return value;
}
