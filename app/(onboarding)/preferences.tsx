import { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSession } from '../../src/features/auth/session-provider';
import { useGenders } from '../../src/features/profile/use-profile';
import { validatePreferences } from '../../src/features/profile/validation';
import { upsertPreferences } from '../../src/features/profile/profile-api';
import { authErrorMessage } from '../../src/features/auth/errors';
import { AppButton } from '../../src/components/AppButton';
import { ErrorText } from '../../src/components/ErrorText';
import { Colors, Radii, Spacing } from '../../src/lib/theme';

export default function Preferences() {
  const router = useRouter();
  const { session } = useSession();
  const { data: genders } = useGenders();
  const [seeking, setSeeking] = useState<string[]>([]);
  const [ageMin, setAgeMin] = useState('18');
  const [ageMax, setAgeMax] = useState('40');
  const [distance, setDistance] = useState('50');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSeeking((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function onNext() {
    if (!session) return;
    setError(null);
    const input = {
      age_min: parseInt(ageMin, 10),
      age_max: parseInt(ageMax, 10),
      max_distance_km: parseInt(distance, 10),
      seekingGenderCount: seeking.length,
    };
    const errs = validatePreferences(input);
    const first = errs.age_min || errs.age_max || errs.max_distance_km || errs.seekingGenders;
    if (first) return setError(first);
    setBusy(true);
    try {
      await upsertPreferences(
        { age_min: input.age_min, age_max: input.age_max, max_distance_km: input.max_distance_km },
        seeking,
      );
      router.push('/(onboarding)/location');
    } catch (e: any) {
      Alert.alert('Préférences', authErrorMessage(e?.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: Spacing.xxl, gap: Spacing.md }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Tu cherches…</Text>
      {(genders ?? []).map((g) => (
        <Pressable key={g.id} onPress={() => toggle(g.id)}
          style={({ pressed }) => ({ padding: 14, borderRadius: Radii.sm, borderWidth: 1, borderColor: seeking.includes(g.id) ? Colors.primary : Colors.border, backgroundColor: seeking.includes(g.id) ? Colors.primaryBg : Colors.white, opacity: pressed ? 0.7 : 1 })}>
          <Text>{g.label}</Text>
        </Pressable>
      ))}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput placeholder="Âge min" value={ageMin} onChangeText={setAgeMin} keyboardType="number-pad"
          style={{ flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.sm, padding: Spacing.md }} />
        <TextInput placeholder="Âge max" value={ageMax} onChangeText={setAgeMax} keyboardType="number-pad"
          style={{ flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.sm, padding: Spacing.md }} />
      </View>
      <TextInput placeholder="Distance max (km)" value={distance} onChangeText={setDistance} keyboardType="number-pad"
        style={{ borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.sm, padding: Spacing.md }} />
      <ErrorText message={error} />
      <AppButton title="Continuer" onPress={onNext} loading={busy} />
    </SafeAreaView>
  );
}
