import { useEffect, useState } from 'react';
import { Alert, Platform, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { validateCredentials } from '../../src/features/auth/validation';
import { authErrorMessage } from '../../src/features/auth/errors';
import {
  signInWithEmail,
  signInWithAppleIdToken,
  signInWithGoogleIdToken,
} from '../../src/features/auth/auth-api';
import { AppButton } from '../../src/components/AppButton';
import { ErrorText } from '../../src/components/ErrorText';
import { Colors, Radii, Spacing } from '../../src/lib/theme';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) {
      GoogleSignin.configure({ webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID });
    }
  }, []);

  async function onEmailSubmit() {
    const found = validateCredentials(email, password);
    setErrors(found);
    if (found.email || found.password) return;
    setBusy(true);
    try {
      await signInWithEmail(email, password);
    } catch (e: any) {
      Alert.alert('Connexion', authErrorMessage(e?.message));
    } finally {
      setBusy(false);
    }
  }

  async function onApple() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('No identityToken.');
      await signInWithAppleIdToken(credential.identityToken);
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return;
      Alert.alert('Apple', authErrorMessage(e?.message));
    }
  }

  async function onGoogle() {
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      const idToken = response.data?.idToken;
      if (!idToken) throw new Error('No idToken.');
      await signInWithGoogleIdToken(idToken);
    } catch (e: any) {
      Alert.alert('Google', authErrorMessage(e?.message));
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.md }}>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>Connexion</Text>
      <TextInput
        placeholder="E-mail"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{ borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.sm, padding: Spacing.md }}
      />
      <ErrorText message={errors.email} />
      <TextInput
        placeholder="Mot de passe"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{ borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.sm, padding: Spacing.md }}
      />
      <ErrorText message={errors.password} />
      <AppButton title="Se connecter" onPress={onEmailSubmit} loading={busy} />

      {Platform.OS === 'ios' ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={8}
          style={{ height: 48 }}
          onPress={onApple}
        />
      ) : null}

      <AppButton title="Continuer avec Google" onPress={onGoogle} variant="secondary" />

      <Link href="/sign-up">Pas de compte ? S'inscrire</Link>
    </SafeAreaView>
  );
}
