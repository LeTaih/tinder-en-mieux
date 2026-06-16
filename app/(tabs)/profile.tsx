import { Alert, Image, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSession } from '../../src/features/auth/session-provider';
import { useMyProfile } from '../../src/features/profile/use-profile';
import { useUpdateMyLocation } from '../../src/features/profile/use-location-check';
import { signedPhotoUrl } from '../../src/features/profile/signed-url';
import { signOut } from '../../src/features/auth/auth-api';
import { authErrorMessage } from '../../src/features/auth/errors';
import { AppButton } from '../../src/components/AppButton';
import { Colors, FontSizes, Radii, Spacing } from '../../src/lib/theme';

export default function Profile() {
  const router = useRouter();
  const { session } = useSession();
  const { data } = useMyProfile(session?.user.id);
  const { update: updateLocation, busy: locationBusy } = useUpdateMyLocation(session?.user.id);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const first = data?.photos[0];
    if (first) signedPhotoUrl(first.storage_path).then((url) => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [data]);

  async function onSignOut() {
    try {
      await signOut();
    } catch (e: any) {
      Alert.alert('Déconnexion', authErrorMessage(e?.message));
    }
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, padding: Spacing.xxl }}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={{ width: 120, height: 160, borderRadius: Radii.md }} />
      ) : (
        <View style={{ width: 120, height: 160, borderRadius: Radii.md, backgroundColor: Colors.placeholder, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 32 }}>📷</Text>
        </View>
      )}
      <Text style={{ fontSize: FontSizes.xl, fontWeight: '700' }}>{data?.profile?.display_name ?? 'Profil'}</Text>
      {data?.profile?.location_label ? (
        <Text style={{ color: Colors.textMuted }}>📍 {data.profile.location_label}</Text>
      ) : null}
      {!photoUrl ? <Text style={{ color: Colors.textMuted, textAlign: 'center' }}>Ajoute une photo à ton profil.</Text> : null}
      {data?.profile?.bio ? <Text style={{ textAlign: 'center' }}>{data.profile.bio}</Text> : null}
      <AppButton title="Éditer mon profil" onPress={() => router.push('/profile-edit')} />
      <AppButton
        title={data?.profile?.location_label ? 'Mettre à jour ma position' : 'Définir ma position'}
        onPress={updateLocation}
        loading={locationBusy}
        variant="secondary"
      />
      <AppButton title="Se déconnecter" onPress={onSignOut} variant="secondary" />
    </View>
  );
}
