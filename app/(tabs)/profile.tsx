import { Alert, Button, Text, View } from 'react-native';
import { signOut } from '../../src/features/auth/auth-api';
import { authErrorMessage } from '../../src/features/auth/errors';

export default function Profile() {
  async function onSignOut() {
    try {
      await signOut();
    } catch (e: any) {
      Alert.alert('Déconnexion', authErrorMessage(e?.message));
    }
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <Text>Profil (à venir — Plan 2)</Text>
      <Button title="Se déconnecter" onPress={onSignOut} />
    </View>
  );
}
