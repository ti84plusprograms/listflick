import React, { createContext, useContext, useEffect, useState } from 'react';
import { getApp } from '@react-native-firebase/app';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import type { User } from '@react-native-firebase/auth';
import { authDebugLog, authDebugWarn, describeAuthUser } from '../utils/authDebug';
import { clearSignedImageUrlCache } from '../utils/signedImageUrlCache';

type AuthContextType = {
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType>({ user: null, loading: true });

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getAuth(getApp());
    authDebugLog('auth provider mounted', {
      hasCurrentUser: Boolean(auth.currentUser),
      currentUser: describeAuthUser(auth.currentUser),
    });

    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        authDebugLog('Firebase auth state changed', describeAuthUser(currentUser));
        clearSignedImageUrlCache();
        authDebugLog('signed image URL cache cleared after auth state change');
        setUser(currentUser);
        setLoading(false);
        authDebugLog('auth context ready', { loading: false, ...describeAuthUser(currentUser) });
      },
      (error) => {
        authDebugWarn('Firebase auth state listener failed', { message: error.message });
        setLoading(false);
      },
    );

    return () => {
      authDebugLog('auth provider unmounted; removing Firebase listener');
      unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
