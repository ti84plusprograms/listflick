import { getApp } from "@react-native-firebase/app";
import { getAuth, getIdToken } from "@react-native-firebase/auth";
import type { User } from "@react-native-firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { IS_E2E } from "../constants/config";
import { authDebugLog } from "../utils/authDebug";

export const E2E_SIMULATED_USER_STORAGE_KEY = "@listflick_e2e_simulated_user";

export interface SimulatedUserData {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export type AuthUser = User | (SimulatedUserData & { getIdToken: (forceRefresh?: boolean) => Promise<string> });

let activeSimulatedUser: AuthUser | null = null;

export function deterministicUidFromEmail(email: string): string {
  const clean = email.trim().toLowerCase().replace(/[^a-z0-9]/g, "-");
  return `e2e-${clean || "user"}`;
}

export function createSimulatedUser(email: string, displayName?: string | null): AuthUser {
  const uid = deterministicUidFromEmail(email);
  return {
    uid,
    email: email.trim(),
    displayName: displayName ?? email.split("@")[0] ?? "E2E User",
    getIdToken: async () => `e2e-token-${uid}`,
  };
}

export function getActiveSimulatedUser(): AuthUser | null {
  return activeSimulatedUser;
}

export function setActiveSimulatedUser(user: AuthUser | null): void {
  activeSimulatedUser = user;
}

export function getAuthUser(): AuthUser | null {
  if (IS_E2E && activeSimulatedUser) {
    return activeSimulatedUser;
  }
  try {
    return getAuth(getApp()).currentUser;
  } catch {
    return null;
  }
}

export async function getAuthIdToken(
  user?: AuthUser | null,
  forceRefresh: boolean = false
): Promise<string | null> {
  const target = user ?? getAuthUser();
  if (!target) return null;
  if ("getIdToken" in target && typeof target.getIdToken === "function") {
    return target.getIdToken(forceRefresh);
  }
  return getIdToken(target as User, forceRefresh);
}

export async function loadStoredSimulatedUser(): Promise<AuthUser | null> {
  if (!IS_E2E) return null;
  try {
    const raw = await AsyncStorage.getItem(E2E_SIMULATED_USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SimulatedUserData;
    if (parsed.email) {
      const user = createSimulatedUser(parsed.email, parsed.displayName);
      setActiveSimulatedUser(user);
      return user;
    }
  } catch (error) {
    authDebugLog("failed to load stored simulated user", { error: String(error) });
  }
  return null;
}

export async function persistSimulatedUser(user: AuthUser | null): Promise<void> {
  if (!IS_E2E) return;
  try {
    if (user) {
      const data: SimulatedUserData = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      };
      await AsyncStorage.setItem(E2E_SIMULATED_USER_STORAGE_KEY, JSON.stringify(data));
    } else {
      await AsyncStorage.removeItem(E2E_SIMULATED_USER_STORAGE_KEY);
    }
  } catch (error) {
    authDebugLog("failed to persist simulated user", { error: String(error) });
  }
}
