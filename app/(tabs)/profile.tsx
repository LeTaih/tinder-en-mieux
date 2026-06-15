import { Alert, Button, Image, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import { useSession } from '../../src/features/auth/session-provider';
import { useMyProfile } from '../../src/features/profile/use-profile';
import { signedPhotoUrl } from '../../src/features/profile/signed-url';
import { signOut } from '../../src/features/auth/auth-api';
import { authErrorMessage } from '../../src/features/auth/errors';

export default function Profile() {
  const { session } = useSession();
  const { data } = useMyProfile(session?.user.id);
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
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
      {photoUrl ? <Image source={{ uri: photoUrl }} style={{ width: 120, height: 160, borderRadius: 12 }} /> : null}
      <Text style={{ fontSize: 20, fontWeight: '700' }}>{data?.profile?.display_name ?? 'Profil'}</Text>
      {data?.profile?.bio ? <Text style={{ textAlign: 'center' }}>{data.profile.bio}</Text> : null}
      <Button title="Se déconnecter" onPress={onSignOut} />
    </View>
  );
}
