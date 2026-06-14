import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { validateCredentials } from '../../src/features/auth/validation';
import { authErrorMessage } from '../../src/features/auth/errors';
import { signUpWithEmail } from '../../src/features/auth/auth-api';

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
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>Créer un compte</Text>
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
      <Button title={busy ? '...' : "S'inscrire"} onPress={onSubmit} disabled={busy} />
      <Link href="/sign-in">Déjà un compte ? Se connecter</Link>
    </View>
  );
}
