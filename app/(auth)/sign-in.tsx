import { useState } from 'react';
import { Alert, Button, Platform, Text, TextInput, View } from 'react-native';
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

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);

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
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>Connexion</Text>
      <TextInput
        placeholder="E-mail"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
      />
      {errors.email ? <Text style={{ color: 'red' }}>{errors.email}</Text> : null}
      <TextInput
        placeholder="Mot de passe"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
      />
      {errors.password ? <Text style={{ color: 'red' }}>{errors.password}</Text> : null}
      <Button title={busy ? '...' : 'Se connecter'} onPress={onEmailSubmit} disabled={busy} />

      {Platform.OS === 'ios' ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={8}
          style={{ height: 48 }}
          onPress={onApple}
        />
      ) : null}

      <Button title="Continuer avec Google" onPress={onGoogle} />

      <Link href="/sign-up">Pas de compte ? S'inscrire</Link>
    </View>
  );
}
