import { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useInterests } from '../../src/features/profile/use-catalogs';
import { setMyInterests } from '../../src/features/profile/profile-api';
import { InterestSelector } from '../../src/features/profile/InterestSelector';
import { AppButton } from '../../src/components/AppButton';
import { Spacing, FontSizes, Colors } from '../../src/lib/theme';

export default function InterestsStep() {
  const router = useRouter();
  const { data: interests = [] } = useInterests();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function onNext(save: boolean) {
    if (save && selected.length > 0) {
      setBusy(true);
      try {
        await setMyInterests(selected);
      } catch (e: any) {
        Alert.alert('Centres d’intérêt', e?.message ?? 'Réessaie.');
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    router.push('/(onboarding)/preferences');
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: Spacing.xxl, gap: Spacing.lg }}>
        <Text style={{ fontSize: FontSizes.xl, fontWeight: '700' }}>Tes centres d&apos;intérêt</Text>
        <Text style={{ color: Colors.textMuted }}>Optionnel — tu pourras les modifier plus tard.</Text>
        <InterestSelector all={interests} selectedIds={selected} onChange={setSelected} />
        <AppButton title="Continuer" onPress={() => onNext(true)} loading={busy} />
        <AppButton title="Passer" onPress={() => onNext(false)} variant="secondary" />
      </ScrollView>
    </SafeAreaView>
  );
}
