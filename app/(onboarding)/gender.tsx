import { useState } from 'react';
import { Alert, Button, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../../src/features/auth/session-provider';
import { useGenders } from '../../src/features/profile/use-profile';
import { upsertIdentity } from '../../src/features/profile/profile-api';
import { authErrorMessage } from '../../src/features/auth/errors';

export default function Gender() {
  const router = useRouter();
  const { session } = useSession();
  const params = useLocalSearchParams<{ name: string; birthdate: string; bio: string }>();
  const { data: genders, isLoading } = useGenders();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onNext() {
    if (!selected || !session) return;
    setBusy(true);
    try {
      await upsertIdentity(session.user.id, {
        display_name: String(params.name),
        birthdate: String(params.birthdate),
        gender_id: selected,
        bio: params.bio ? String(params.bio) : null,
      });
      router.push('/(onboarding)/photos');
    } catch (e: any) {
      Alert.alert('Genre', authErrorMessage(e?.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Ton genre</Text>
      {isLoading ? <Text>Chargement…</Text> : null}
      {(genders ?? []).map((g) => (
        <Pressable key={g.id} onPress={() => setSelected(g.id)}
          style={{ padding: 14, borderRadius: 8, borderWidth: 1, borderColor: selected === g.id ? '#208AEF' : '#ccc', backgroundColor: selected === g.id ? '#E6F0FF' : 'white' }}>
          <Text>{g.label}</Text>
        </Pressable>
      ))}
      <Button title={busy ? '...' : 'Continuer'} onPress={onNext} disabled={busy || !selected} />
    </View>
  );
}
