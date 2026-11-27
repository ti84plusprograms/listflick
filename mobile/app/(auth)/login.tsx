import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getApp } from '@react-native-firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
} from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { Ionicons } from '@expo/vector-icons';
import { BRAND_NAME } from '@/constants/brand';
import { theme, themedStyles } from '@/constants/theme';
import { useAuth } from '@/state/AuthContext';
import { authDebugLog, authDebugWarn, describeAuthUser } from '@/utils/authDebug';
import { ListFlickMark } from '@/components/brand/ListFlickMark';

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
const googleSignInConfigured = Boolean(
  GOOGLE_WEB_CLIENT_ID && (Platform.OS !== 'ios' || GOOGLE_IOS_CLIENT_ID),
);

if (googleSignInConfigured) {
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
  });
}

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);

  const handleEmailAuth = async () => {
    Keyboard.dismiss();
    if (!email.trim() || !password.trim()) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    setError('');
    authDebugLog('email authentication started', {
      mode: isSignUp ? 'sign_up' : 'sign_in',
      emailDomain: email.split('@')[1]?.toLowerCase() ?? 'missing',
    });

    try {
      const user = isSignUp
        ? await signUp(email.trim(), password)
        : await signIn(email.trim(), password);
      authDebugLog('email authentication succeeded', describeAuthUser(user));
    } catch (e: any) {
      authDebugWarn('email authentication failed', { code: e?.code, message: e?.message });
      if (e.code === 'auth/invalid-credential' || e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password') {
        setError('No account found with that email or password. Please create an account instead.');
      } else if (e.code === 'auth/email-already-in-use') {
        setError('An account already exists with this email address.');
      } else {
        setError(e.message || 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!googleSignInConfigured) {
      setError('Google Sign-In is not configured for this build.');
      return;
    }
    setLoading(true);
    setError('');
    authDebugLog('Google authentication started');

    try {
      // Check if your device supports Google Play
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      // Get the users ID token
      const response = await GoogleSignin.signIn();
      const idToken = response.data?.idToken || (response as any).idToken;

      // Create a Google credential with the token
      const googleCredential = GoogleAuthProvider.credential(idToken);

      // Sign-in the user with the credential
      const auth = getAuth(getApp());
      await signInWithCredential(auth, googleCredential);
      authDebugLog('Google authentication succeeded', describeAuthUser(auth.currentUser));
    } catch (e: any) {
      authDebugWarn('Google authentication failed', { code: e?.code, message: e?.message });
      setError('Google Sign-In failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} testID="login-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.headerContainer}>
          <ListFlickMark size={64} />
          <Text style={styles.title}>Welcome to{'\n'}{BRAND_NAME}</Text>
          <Text style={styles.subtitle}>
            {isSignUp ? 'Create an account to save and sync your listings' : 'Sign in to save and sync your listings'}
          </Text>
        </View>

        <View style={styles.formContainer}>
          {error ? <Text testID="auth-error-message" style={styles.errorText}>{error}</Text> : null}

          <TextInput
            testID="auth-email-input"
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={theme.colors.textSecondary}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="none"
            autoComplete="off"
            autoCorrect={false}
          />

          <TextInput
            testID="auth-password-input"
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={theme.colors.textSecondary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="none"
            autoComplete="off"
            autoCorrect={false}
          />

          <TouchableOpacity
            testID="auth-submit-button"
            style={[styles.primaryButton, loading && styles.disabledButton]}
            onPress={handleEmailAuth}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {isSignUp ? 'Create Account' : 'Sign In'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            testID="auth-toggle-mode-button"
            style={styles.switchButton}
            onPress={() => setIsSignUp(!isSignUp)}
            disabled={loading}
          >
            <Text style={styles.switchButtonText}>
              {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
            </Text>
          </TouchableOpacity>
        </View>

        {googleSignInConfigured ? (
          <>
            <View style={styles.dividerContainer}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.divider} />
            </View>

            <TouchableOpacity
              style={styles.googleButton}
              onPress={handleGoogleSignIn}
              disabled={loading}
            >
              <Ionicons name="logo-google" size={24} color={theme.colors.textPrimary} />
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  keyboardView: {
    flex: 1,
    padding: theme.spacing.screenPadding,
    justifyContent: 'center',
  },
  headerContainer: {
    marginBottom: theme.spacing.sectionGap,
  },
  // logo: {
  //   marginBottom: theme.spacing.fieldGap,
  // },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    lineHeight: 40,
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    fontSize: 16,
    color: theme.colors.textSecondary,
  },
  formContainer: {
    marginBottom: theme.spacing.sectionGap,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.card,
    padding: theme.spacing.fieldGap,
    fontSize: 16,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.fieldGap,
  },
  primaryButton: {
    backgroundColor: theme.colors.accent,
    padding: theme.spacing.fieldGap,
    borderRadius: theme.radius.button,
    alignItems: 'center',
    marginTop: theme.spacing.sm,
  },
  disabledButton: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  switchButton: {
    marginTop: theme.spacing.screenPadding,
    alignItems: 'center',
  },
  switchButtonText: {
    color: theme.colors.accent,
    fontSize: 14,
    fontWeight: '500',
  },
  errorText: {
    color: '#FF3B30',
    marginBottom: theme.spacing.fieldGap,
    textAlign: 'center',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sectionGap,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  dividerText: {
    color: theme.colors.textTertiary,
    paddingHorizontal: theme.spacing.fieldGap,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.fieldGap,
    borderRadius: theme.radius.button,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  googleButtonText: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: theme.spacing.sm,
  },
}));
