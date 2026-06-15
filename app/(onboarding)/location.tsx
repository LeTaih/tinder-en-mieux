import { useState } from 'react';
import { Alert, Button, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useSession } from '../../src/features/auth/session-provider';
import { setMyLocation } from '../../src/features/profile/profile-api';
import { authErrorMessage } from '../../src/features/auth/errors';

export default function LocationStep() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function onFinish() {
    if (!session) return;
    setBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Localisation', 'Permission refusée. Elle est nécessaire pour te proposer des profils proches.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      await setMyLocation(pos.coords.longitude, pos.coords.latitude);
      await queryClient.invalidateQueries({ queryKey: ['my-profile', session.user.id] });
    } catch (e: any) {
      Alert.alert('Localisation', authErrorMessage(e?.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center' }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Ta position</Text>
      <Text>On utilise ta position pour te proposer des profils proches. Elle n'est jamais partagée précisément.</Text>
      <Button title={busy ? '...' : 'Activer la localisation et terminer'} onPress={onFinish} disabled={busy} />
    </View>
  );
}
