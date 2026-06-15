import { useState } from 'react';
import { Alert, Button, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../../src/features/auth/session-provider';
import { useGenders } from '../../src/features/profile/use-profile';
import { validatePreferences } from '../../src/features/profile/validation';
import { upsertPreferences } from '../../src/features/profile/profile-api';
import { authErrorMessage } from '../../src/features/auth/errors';

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
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Tu cherches…</Text>
      {(genders ?? []).map((g) => (
        <Pressable key={g.id} onPress={() => toggle(g.id)}
          style={{ padding: 14, borderRadius: 8, borderWidth: 1, borderColor: seeking.includes(g.id) ? '#208AEF' : '#ccc', backgroundColor: seeking.includes(g.id) ? '#E6F0FF' : 'white' }}>
          <Text>{g.label}</Text>
        </Pressable>
      ))}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput placeholder="Âge min" value={ageMin} onChangeText={setAgeMin} keyboardType="number-pad"
          style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }} />
        <TextInput placeholder="Âge max" value={ageMax} onChangeText={setAgeMax} keyboardType="number-pad"
          style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }} />
      </View>
      <TextInput placeholder="Distance max (km)" value={distance} onChangeText={setDistance} keyboardType="number-pad"
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }} />
      {error ? <Text style={{ color: 'red' }}>{error}</Text> : null}
      <Button title={busy ? '...' : 'Continuer'} onPress={onNext} disabled={busy} />
    </View>
  );
}
