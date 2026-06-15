import { useState } from 'react';
import { Platform, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSession } from '../../src/features/auth/session-provider';
import { isAdult } from '../../src/features/profile/validation';
import { AppButton } from '../../src/components/AppButton';
import { ErrorText } from '../../src/components/ErrorText';
import { Colors, Radii, Spacing } from '../../src/lib/theme';

export default function Identity() {
  const router = useRouter();
  const { session } = useSession();
  const [name, setName] = useState('');
  const [birthdate, setBirthdate] = useState(''); // format AAAA-MM-JJ
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onNext() {
    setError(null);
    if (name.trim().length === 0) return setError('Indique ton prénom.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return setError('Date au format AAAA-MM-JJ.');
    if (!isAdult(birthdate, new Date())) return setError('Tu dois avoir au moins 18 ans.');
    router.push({ pathname: '/(onboarding)/gender', params: { name: name.trim(), birthdate, bio } });
  }

  if (!session) return null;

  return (
    <SafeAreaView style={{ flex: 1, padding: Spacing.xxl, gap: Spacing.md }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Qui es-tu ?</Text>
      <TextInput placeholder="Prénom" value={name} onChangeText={setName}
        style={{ borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.sm, padding: Spacing.md }} />
      <TextInput placeholder="Date de naissance (AAAA-MM-JJ)" value={birthdate} onChangeText={setBirthdate}
        autoCapitalize="none" keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
        style={{ borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.sm, padding: Spacing.md }} />
      <TextInput placeholder="Bio (optionnel)" value={bio} onChangeText={setBio} multiline
        style={{ borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.sm, padding: Spacing.md, minHeight: 80 }} />
      <ErrorText message={error} />
      <AppButton title="Continuer" onPress={onNext} />
    </SafeAreaView>
  );
}
