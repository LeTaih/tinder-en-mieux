import { useEffect, useState } from 'react';
import { Alert, Button, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { randomUUID } from 'expo-crypto';
import { useSession } from '../../src/features/auth/session-provider';
import { useMyProfile } from '../../src/features/profile/use-profile';
import { supabase } from '../../src/lib/supabase';
import { insertPhoto } from '../../src/features/profile/profile-api';
import { signedPhotoUrl } from '../../src/features/profile/signed-url';
import { PHOTO_COMPRESS, PHOTO_MAX_DIMENSION, photoStoragePath } from '../../src/features/profile/image';
import { authErrorMessage } from '../../src/features/auth/errors';

declare const atob: (s: string) => string;

type Thumb = { id: string; url: string };

export default function Photos() {
  const router = useRouter();
  const { session } = useSession();
  const qc = useQueryClient();
  const userId = session?.user.id;
  // La base est la source de vérité : on en dérive le nombre de photos, leur position et l'affichage.
  const { data: myProfile, isLoading } = useMyProfile(userId);
  const dbPhotos = myProfile?.photos ?? [];
  const count = dbPhotos.length;
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [busy, setBusy] = useState(false);

  // Affiche les photos déjà enregistrées (URLs signées), y compris au retour sur l'écran.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      dbPhotos.map(async (p) => ({ id: p.id, url: await signedPhotoUrl(p.storage_path) })),
    ).then((res) => {
      if (!cancelled) setThumbs(res.filter((r): r is Thumb => !!r.url));
    });
    return () => {
      cancelled = true;
    };
  }, [myProfile]);

  async function pick(fromCamera: boolean) {
    if (!userId || isLoading) return;
    if (count >= 6) {
      Alert.alert('Photos', 'Maximum 6 photos.');
      return;
    }
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return Alert.alert('Permission', 'Accès refusé.');
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [3, 4], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [3, 4], quality: 1 });
      if (result.canceled) return;
      setBusy(true);
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: PHOTO_MAX_DIMENSION } }],
        { compress: PHOTO_COMPRESS, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) throw new Error('Compression échouée');
      const path = photoStoragePath(userId, randomUUID());
      const bytes = Uint8Array.from(atob(manipulated.base64), (c) => c.charCodeAt(0));
      const { error } = await supabase.storage.from('profile-photos').upload(path, bytes, { contentType: 'image/jpeg' });
      if (error) throw error;
      // position = nombre de photos déjà en base (jamais un compteur local périmé) -> pas de collision.
      await insertPhoto(userId, path, count);
      await qc.invalidateQueries({ queryKey: ['my-profile', userId] });
    } catch (e: any) {
      Alert.alert('Photos', authErrorMessage(e?.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Tes photos (1 à 6)</Text>
      <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
        {thumbs.map((t) => (
          <Image key={t.id} source={{ uri: t.url }} style={{ width: 90, height: 120, borderRadius: 8 }} />
        ))}
      </ScrollView>
      <Pressable onPress={() => pick(false)} disabled={busy || isLoading}>
        <Text style={{ color: '#208AEF', padding: 8 }}>＋ Galerie</Text>
      </Pressable>
      <Pressable onPress={() => pick(true)} disabled={busy || isLoading}>
        <Text style={{ color: '#208AEF', padding: 8 }}>＋ Appareil photo</Text>
      </Pressable>
      <Button
        title="Continuer"
        onPress={() => router.push('/(onboarding)/preferences')}
        disabled={count < 1 || busy}
      />
    </View>
  );
}
