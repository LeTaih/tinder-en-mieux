import { useState } from 'react';
import { Alert, Button, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { randomUUID } from 'expo-crypto';
import { useSession } from '../../src/features/auth/session-provider';
import { supabase } from '../../src/lib/supabase';
import { insertPhoto } from '../../src/features/profile/profile-api';
import { PHOTO_COMPRESS, PHOTO_MAX_DIMENSION, photoStoragePath } from '../../src/features/profile/image';
import { authErrorMessage } from '../../src/features/auth/errors';

declare const atob: (s: string) => string;

type LocalPhoto = { uri: string; storagePath: string };

export default function Photos() {
  const router = useRouter();
  const { session } = useSession();
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [busy, setBusy] = useState(false);

  async function processAndUpload(uri: string) {
    if (!session) return;
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: PHOTO_MAX_DIMENSION } }],
      { compress: PHOTO_COMPRESS, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    if (!manipulated.base64) throw new Error('Compression échouée');
    const path = photoStoragePath(session.user.id, randomUUID());
    const bytes = Uint8Array.from(atob(manipulated.base64), (c) => c.charCodeAt(0));
    const { error } = await supabase.storage.from('profile-photos').upload(path, bytes, { contentType: 'image/jpeg' });
    if (error) throw error;
    await insertPhoto(session.user.id, path, photos.length);
    setPhotos((prev) => [...prev, { uri: manipulated.uri, storagePath: path }]);
  }

  async function pick(fromCamera: boolean) {
    if (photos.length >= 6) return Alert.alert('Photos', 'Maximum 6 photos.');
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
      await processAndUpload(result.assets[0].uri);
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
        {photos.map((p) => (
          <Image key={p.storagePath} source={{ uri: p.uri }} style={{ width: 90, height: 120, borderRadius: 8 }} />
        ))}
      </ScrollView>
      <Pressable onPress={() => pick(false)} disabled={busy}>
        <Text style={{ color: '#208AEF', padding: 8 }}>＋ Galerie</Text>
      </Pressable>
      <Pressable onPress={() => pick(true)} disabled={busy}>
        <Text style={{ color: '#208AEF', padding: 8 }}>＋ Appareil photo</Text>
      </Pressable>
      <Button title="Continuer" onPress={() => router.push('/(onboarding)/preferences')} disabled={photos.length < 1 || busy} />
    </View>
  );
}
