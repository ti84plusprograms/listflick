(globalThis as any).__DEV__ = true;

import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const storageMap = new Map<string, string>();

let mockCurrentUser: { uid: string } | null = null;

const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
  if (request.includes("firebase")) {
    return {
      getApp: () => ({}),
      getAuth: () => ({
        get currentUser() {
          return mockCurrentUser;
        },
      }),
      getIdToken: async () => "firebase-mock-token",
    };
  }
  if (request.includes("async-storage")) {
    const asyncStorageMock = {
      getItem: async (key: string) => storageMap.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        storageMap.set(key, value);
      },
      removeItem: async (key: string) => {
        storageMap.delete(key);
      },
      clear: async () => {
        storageMap.clear();
      },
    };
    return {
      ...asyncStorageMock,
      default: asyncStorageMock,
    };
  }
  if (request.includes("expo-constants")) {
    const mockConstants = {
      expoConfig: {
        extra: { e2eApiUrl: "http://127.0.0.1:8000" },
      },
    };
    return {
      ...mockConstants,
      default: mockConstants,
    };
  }
  return originalLoad.apply(this, arguments);
};

const {
  deterministicUidFromEmail,
  createSimulatedUser,
  getActiveSimulatedUser,
  setActiveSimulatedUser,
  getAuthUser,
  getAuthIdToken,
  loadStoredSimulatedUser,
  persistSimulatedUser,
  E2E_SIMULATED_USER_STORAGE_KEY,
} = require("../services/authSession") as typeof import("../services/authSession");

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

async function runTests() {
  // 1. deterministicUidFromEmail produces clean, deterministic identifiers
  equal(
    deterministicUidFromEmail("test@example.com"),
    "e2e-test-example-com",
    "standard email converts to deterministic UID"
  );
  equal(
    deterministicUidFromEmail("USER.NAME+tag@LISTFLICK.TEST"),
    "e2e-user-name-tag-listflick-test",
    "mixed case and punctuation normalize to hyphenated lowercase"
  );
  equal(
    deterministicUidFromEmail("   "),
    "e2e-user",
    "empty string falls back to e2e-user"
  );

  // 2. createSimulatedUser builds a complete AuthUser object
  const user = createSimulatedUser("onboarding@listflick.test", "Onboarding Tester");
  equal(user.uid, "e2e-onboarding-listflick-test", "simulated user UID is deterministic");
  equal(user.email, "onboarding@listflick.test", "simulated user email matches");
  equal(user.displayName, "Onboarding Tester", "simulated user displayName matches");

  const token = await user.getIdToken();
  equal(token, "e2e-token-e2e-onboarding-listflick-test", "simulated token has expected prefix and UID");

  // 3. Simulated user fallback display name
  const fallbackUser = createSimulatedUser("seller@listflick.test");
  equal(fallbackUser.displayName, "seller", "default display name uses email prefix");

  // 4. In-memory active simulated user
  setActiveSimulatedUser(user);
  equal(getActiveSimulatedUser()?.uid, user.uid, "getActiveSimulatedUser returns active user");
  equal(getAuthUser()?.uid, user.uid, "getAuthUser returns simulated user when active in E2E");

  // 5. getAuthIdToken handles simulated users
  const resolvedToken = await getAuthIdToken(user);
  equal(resolvedToken, "e2e-token-e2e-onboarding-listflick-test", "getAuthIdToken resolves simulated token");

  // 6. Persistence in AsyncStorage
  await persistSimulatedUser(user);
  equal(storageMap.has(E2E_SIMULATED_USER_STORAGE_KEY), true, "persistSimulatedUser stores user in AsyncStorage");

  // Clear memory and restore from AsyncStorage
  setActiveSimulatedUser(null);
  equal(getActiveSimulatedUser(), null, "active user is cleared in memory");

  const restored = await loadStoredSimulatedUser();
  equal(restored?.uid, user.uid, "loadStoredSimulatedUser restores user from AsyncStorage");
  equal(getActiveSimulatedUser()?.uid, user.uid, "loadStoredSimulatedUser also updates active in-memory user");

  // Sign out removes from AsyncStorage
  await persistSimulatedUser(null);
  equal(storageMap.has(E2E_SIMULATED_USER_STORAGE_KEY), false, "persistSimulatedUser(null) deletes storage entry");
  setActiveSimulatedUser(null);

  // 7. Static code checks for E2E guardrails
  const authSessionSource = readFileSync(resolve(__dirname, "../services/authSession.ts"), "utf8");
  if (!authSessionSource.includes("if (!IS_E2E) return null;")) {
    throw new Error("authSession.ts must guard loadStoredSimulatedUser with IS_E2E check");
  }
  if (!authSessionSource.includes("if (!IS_E2E) return;")) {
    throw new Error("authSession.ts must guard persistSimulatedUser with IS_E2E check");
  }

  const authContextSource = readFileSync(resolve(__dirname, "../state/AuthContext.tsx"), "utf8");
  if (!authContextSource.includes("if (IS_E2E)")) {
    throw new Error("AuthContext.tsx must guard simulated auth with IS_E2E check");
  }
  if (!authContextSource.includes("signInSimulated") || !authContextSource.includes("signUpSimulated")) {
    throw new Error("AuthContext.tsx must invoke simulated auth handlers in E2E mode");
  }
  if (!authContextSource.includes("signOutSimulated")) {
    throw new Error("AuthContext.tsx must invoke signOutSimulated in E2E mode");
  }

  const loginSource = readFileSync(resolve(__dirname, "../app/(auth)/login.tsx"), "utf8");
  if (loginSource.includes("IS_E2E")) {
    throw new Error("login.tsx should not leak IS_E2E branching; use AuthContext");
  }
  if (!loginSource.includes("signUp(email.trim(), password)") || !loginSource.includes("signIn(email.trim(), password)")) {
    throw new Error("login.tsx must use centralized signIn and signUp from useAuth()");
  }

  const settingsSource = readFileSync(resolve(__dirname, "../app/(tabs)/settings.tsx"), "utf8");
  if (settingsSource.includes("IS_E2E")) {
    throw new Error("settings.tsx should not leak IS_E2E branching; use AuthContext");
  }
  if (!settingsSource.includes("await signOut()")) {
    throw new Error("settings.tsx must use centralized signOut() from useAuth()");
  }

  const backendAuthSource = readFileSync(resolve(__dirname, "../../backend/app/auth.py"), "utf8");
  if (!backendAuthSource.includes("settings.e2e_mode and token.startswith(\"e2e-token-\")")) {
    throw new Error("backend/app/auth.py must guard e2e token acceptance with settings.e2e_mode");
  }

  console.log("User auth simulation tests passed.");
}

void runTests();
