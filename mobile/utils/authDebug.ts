export function authDebugLog(message: string, details?: Record<string, unknown>) {
  if (__DEV__) console.log(`[Auth] ${message}`, details ?? "");
}

export function authDebugWarn(message: string, details?: Record<string, unknown>) {
  if (__DEV__) console.warn(`[Auth] ${message}`, details ?? "");
}

export function describeAuthUser(user: { uid: string; isAnonymous?: boolean; providerData?: Array<{ providerId: string }> } | null) {
  if (!user) return { signedIn: false };
  return {
    signedIn: true,
    uid: user.uid,
    isAnonymous: Boolean(user.isAnonymous),
    providers: user.providerData?.map(({ providerId }) => providerId) ?? [],
  };
}
