import { useState } from 'react';
import { Alert, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { validateCredentials } from '../../src/features/auth/validation';
import { authErrorMessage } from '../../src/features/auth/errors';
import { signUpWithEmail } from '../../src/features/auth/auth-api';
import { AppButton } from '../../src/components/AppButton';
import { ErrorText } from '../../src/components/ErrorText';
import { Colors, Radii, Spacing } from '../../src/lib/theme';

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    const found = validateCredentials(email, password);
    setErrors(found);
    if (found.email || found.password) return;
    setBusy(true);
    try {
      await signUpWithEmail(email, password);
      Alert.alert('Compte créé', 'Vérifie ton e-mail si une confirmation est requise.');
    } catch (e: any) {
      Alert.alert('Inscription', authErrorMessage(e?.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.md }}>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>Créer un compte</Text>
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
      <AppButton title="S'inscrire" onPress={onSubmit} loading={busy} />
      <Link href="/sign-in">Déjà un compte ? Se connecter</Link>
    </SafeAreaView>
  );
}
