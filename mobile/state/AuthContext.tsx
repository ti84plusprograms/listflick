import React, { createContext, useContext, useEffect, useState } from 'react';
import { getApp } from '@react-native-firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from '@react-native-firebase/auth';
import type { User } from '@react-native-firebase/auth';
import { authDebugLog, authDebugWarn, describeAuthUser } from '../utils/authDebug';
import { clearSignedImageUrlCache } from '../utils/signedImageUrlCache';
import {
  AuthUser,
  createSimulatedUser,
  getActiveSimulatedUser,
  loadStoredSimulatedUser,
  persistSimulatedUser,
  setActiveSimulatedUser,
} from '../services/authSession';
import { IS_E2E } from '../constants/config';

type AuthContextType = {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signUp: (email: string, password: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  signInSimulated: (email: string, password?: string) => Promise<AuthUser>;
  signUpSimulated: (email: string, password?: string) => Promise<AuthUser>;
  signOutSimulated: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => {
    throw new Error("AuthContext is not initialized");
  },
  signUp: async () => {
    throw new Error("AuthContext is not initialized");
  },
  signOut: async () => {},
  signInSimulated: async () => {
    throw new Error("Simulated auth is not supported in production");
  },
  signUpSimulated: async () => {
    throw new Error("Simulated auth is not supported in production");
  },
  signOutSimulated: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const initAuth = async () => {
      if (IS_E2E) {
        const storedSimulated = await loadStoredSimulatedUser();
        if (storedSimulated && active) {
          authDebugLog('Restored stored simulated user in E2E mode', {
            uid: storedSimulated.uid,
            email: storedSimulated.email,
          });
          setUser(storedSimulated);
          setLoading(false);
          return;
        }
      }

      const auth = getAuth(getApp());
      authDebugLog('auth provider mounted', {
        hasCurrentUser: Boolean(auth.currentUser),
        currentUser: describeAuthUser(auth.currentUser),
      });

      const unsubscribe = onAuthStateChanged(
        auth,
        (currentUser) => {
          if (!active) return;
          if (IS_E2E && getActiveSimulatedUser()) {
            return;
          }
          authDebugLog('Firebase auth state changed', describeAuthUser(currentUser));
          clearSignedImageUrlCache();
          authDebugLog('signed image URL cache cleared after auth state change');
          setUser(currentUser);
          setLoading(false);
          authDebugLog('auth context ready', { loading: false, ...describeAuthUser(currentUser) });
        },
        (error) => {
          if (!active) return;
          authDebugWarn('Firebase auth state listener failed', { message: error.message });
          setLoading(false);
        },
      );

      return unsubscribe;
    };

    const cleanupPromise = initAuth();

    return () => {
      active = false;
      authDebugLog('auth provider unmounted; removing Firebase listener');
      void cleanupPromise.then((unsub) => unsub?.());
    };
  }, []);

  const signInSimulated = async (email: string, _password?: string): Promise<AuthUser> => {
    if (!IS_E2E) throw new Error("Simulated auth is only available in E2E mode");
    const simulated = createSimulatedUser(email);
    await persistSimulatedUser(simulated);
    setActiveSimulatedUser(simulated);
    clearSignedImageUrlCache();
    setUser(simulated);
    authDebugLog('Simulated sign-in succeeded', { uid: simulated.uid, email: simulated.email });
    return simulated;
  };

  const signUpSimulated = async (email: string, _password?: string): Promise<AuthUser> => {
    return signInSimulated(email, _password);
  };

  const signOutSimulated = async (): Promise<void> => {
    await persistSimulatedUser(null);
    setActiveSimulatedUser(null);
    clearSignedImageUrlCache();
    setUser(null);
    try {
      const auth = getAuth(getApp());
      await firebaseSignOut(auth);
    } catch {
      // Best effort sign out of underlying Firebase
    }
    authDebugLog('Simulated sign-out completed');
  };

  const signIn = async (email: string, password: string): Promise<AuthUser> => {
    if (IS_E2E) {
      return signInSimulated(email, password);
    }
    const auth = getAuth(getApp());
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user;
  };

  const signUp = async (email: string, password: string): Promise<AuthUser> => {
    if (IS_E2E) {
      return signUpSimulated(email, password);
    }
    const auth = getAuth(getApp());
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    return credential.user;
  };

  const signOut = async (): Promise<void> => {
    if (IS_E2E) {
      await signOutSimulated();
      return;
    }
    const auth = getAuth(getApp());
    await firebaseSignOut(auth);
    clearSignedImageUrlCache();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn,
        signUp,
        signOut,
        signInSimulated,
        signUpSimulated,
        signOutSimulated,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
