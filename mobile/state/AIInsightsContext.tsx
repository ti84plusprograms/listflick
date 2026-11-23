import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { getAIInsightsSettings, saveAIInsightsSettings } from "../services/storage";

interface AIInsightsSettingsValue {
  enabled: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
}

const AIInsightsSettingsContext = createContext<AIInsightsSettingsValue | null>(null);

export function AIInsightsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const hasLocalOverride = useRef(false);

  useEffect(() => {
    let active = true;
    getAIInsightsSettings().then((settings) => {
      if (active && !hasLocalOverride.current) setEnabledState(settings.enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  const setEnabled = useCallback(async (nextEnabled: boolean) => {
    hasLocalOverride.current = true;
    setEnabledState(nextEnabled);
    await saveAIInsightsSettings({ enabled: nextEnabled });
  }, []);

  const value = useMemo(() => ({ enabled, setEnabled }), [enabled, setEnabled]);

  return (
    <AIInsightsSettingsContext.Provider value={value}>
      {children}
    </AIInsightsSettingsContext.Provider>
  );
}

export function useAIInsightsEnabled(): boolean {
  return useAIInsightsSettings().enabled;
}

export function useAIInsightsSettings(): AIInsightsSettingsValue {
  const value = useContext(AIInsightsSettingsContext);
  if (!value) {
    throw new Error("useAIInsightsSettings must be used within AIInsightsProvider");
  }
  return value;
}
