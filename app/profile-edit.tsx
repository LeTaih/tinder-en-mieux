import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../src/features/auth/session-provider';
import { useMyProfile, useInterests, usePrompts } from '../src/features/profile/use-profile-edit';
import { setMyInterests, setMyPrompts, updateMyProfileFields } from '../src/features/profile/profile-api';
import { InterestSelector } from '../src/features/profile/InterestSelector';
import { PromptEditor, type PromptItem } from '../src/features/profile/PromptEditor';
import { AppButton } from '../src/components/AppButton';
import { ErrorText } from '../src/components/ErrorText';
import { isValidHeight, validatePromptAnswer } from '../src/features/profile/rich-validation';
import { Colors, FontSizes, Radii, Spacing } from '../src/lib/theme';

export default function ProfileEdit() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id;
  const { data: me, isLoading } = useMyProfile(userId);
  const { data: interests = [] } = useInterests();
  const { data: prompts = [] } = usePrompts();

  const [bio, setBio] = useState('');
  const [job, setJob] = useState('');
  const [education, setEducation] = useState('');
  const [height, setHeight] = useState('');
  const [interestIds, setInterestIds] = useState<string[]>([]);
  const [promptItems, setPromptItems] = useState<PromptItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    setBio(me.profile?.bio ?? '');
    setJob(me.profile?.job ?? '');
    setEducation(me.profile?.education ?? '');
    setHeight(me.profile?.height_cm ? String(me.profile.height_cm) : '');
    setInterestIds(me.interestIds);
    setPromptItems(me.promptItems);
  }, [me]);

  if (!userId || isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text>Chargement…</Text>
      </SafeAreaView>
    );
  }

  async function onSave() {
    setError(null);
    const h = height.trim() === '' ? null : parseInt(height, 10);
    if (h !== null && (Number.isNaN(h) || !isValidHeight(h))) {
      setError('Taille invalide (120–230 cm).');
      return;
    }
    for (const p of promptItems) {
      const e = validatePromptAnswer(p.answer);
      if (e) {
        setError(`Prompt : ${e}`);
        return;
      }
    }
    setBusy(true);
    try {
      await updateMyProfileFields(userId!, {
        bio: bio.trim() || null,
        job: job.trim() || null,
        education: education.trim() || null,
        height_cm: h,
      });
      await setMyInterests(interestIds);
      await setMyPrompts(promptItems);
      await qc.invalidateQueries({ queryKey: ['my-profile', userId] });
      router.back();
    } catch (e: any) {
      setError(e?.message ?? "Échec de l'enregistrement.");
    } finally {
      setBusy(false);
    }
  }

  const field = { borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.sm, padding: Spacing.md };
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Éditer mon profil' }} />
      <ScrollView contentContainerStyle={{ padding: Spacing.xxl, gap: Spacing.lg }}>
        <Text style={{ fontWeight: '700' }}>Bio</Text>
        <TextInput value={bio} onChangeText={setBio} multiline placeholder="Quelques mots sur toi…" style={[field, { minHeight: 80 }]} />
        <Text style={{ fontWeight: '700' }}>Métier</Text>
        <TextInput value={job} onChangeText={setJob} maxLength={50} placeholder="Ex. Designer" style={field} />
        <Text style={{ fontWeight: '700' }}>Études</Text>
        <TextInput value={education} onChangeText={setEducation} maxLength={50} placeholder="Ex. Beaux-Arts" style={field} />
        <Text style={{ fontWeight: '700' }}>Taille (cm)</Text>
        <TextInput value={height} onChangeText={setHeight} keyboardType="number-pad" maxLength={3} placeholder="170" style={field} />
        <Text style={{ fontSize: FontSizes.lg, fontWeight: '800', marginTop: Spacing.sm }}>Centres d'intérêt</Text>
        <InterestSelector all={interests} selectedIds={interestIds} onChange={setInterestIds} />
        <Text style={{ fontSize: FontSizes.lg, fontWeight: '800', marginTop: Spacing.sm }}>Prompts</Text>
        <PromptEditor allPrompts={prompts} value={promptItems} onChange={setPromptItems} />
        <ErrorText message={error} />
        <AppButton title="Enregistrer" onPress={onSave} loading={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}
