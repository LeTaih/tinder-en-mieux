import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../../src/features/auth/session-provider';
import { useGenders } from '../../src/features/profile/use-profile';
import { upsertIdentity } from '../../src/features/profile/profile-api';
import { authErrorMessage } from '../../src/features/auth/errors';
import { AppButton } from '../../src/components/AppButton';
import { Colors, Radii, Spacing } from '../../src/lib/theme';

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
    <SafeAreaView style={{ flex: 1, padding: Spacing.xxl, gap: Spacing.md }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Ton genre</Text>
      {isLoading ? <ActivityIndicator /> : null}
      {(genders ?? []).map((g) => (
        <Pressable key={g.id} onPress={() => setSelected(g.id)}
          style={({ pressed }) => ({
            padding: 14,
            borderRadius: Radii.sm,
            borderWidth: 1,
            borderColor: selected === g.id ? Colors.primary : Colors.border,
            backgroundColor: selected === g.id ? Colors.primaryBg : Colors.white,
            opacity: pressed ? 0.7 : 1,
          })}>
          <Text>{g.label}</Text>
        </Pressable>
      ))}
      <AppButton title="Continuer" onPress={onNext} loading={busy} disabled={!selected} />
    </SafeAreaView>
  );
}
