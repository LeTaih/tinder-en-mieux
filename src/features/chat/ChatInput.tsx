import { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Radii, Spacing } from '../../lib/theme';

type Props = {
  disabled?: boolean;
  onSendText: (body: string) => void;
  onSendImage: (localUri: string) => void;
};

export function ChatInput({ disabled, onSendText, onSendImage }: Props) {
  const [text, setText] = useState('');

  function submitText() {
    const body = text.trim();
    if (!body || disabled) return;
    onSendText(body);
    setText('');
  }

  async function pickImage() {
    if (disabled) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission', 'Accès aux photos refusé.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 1 });
    if (result.canceled) return;
    onSendImage(result.assets[0].uri);
  }

  const canSend = !disabled && text.trim().length > 0;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm }}>
      <Pressable
        onPress={pickImage}
        disabled={disabled}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Joindre une image"
        style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontSize: 22 }}>📎</Text>
      </Pressable>
      <TextInput
        style={{
          flex: 1,
          borderWidth: 1,
          borderColor: Colors.borderLight,
          borderRadius: Radii.pill,
          paddingHorizontal: 14,
          paddingVertical: Spacing.sm,
        }}
        placeholder="Message…"
        value={text}
        onChangeText={setText}
        editable={!disabled}
        onSubmitEditing={submitText}
        returnKeyType="send"
      />
      <Pressable
        onPress={submitText}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Envoyer"
        style={{
          backgroundColor: Colors.primary,
          opacity: canSend ? 1 : 0.4,
          minWidth: 44,
          minHeight: 44,
          paddingHorizontal: Spacing.lg,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: Radii.pill,
        }}
      >
        <Text style={{ color: Colors.white, fontSize: 18 }}>➤</Text>
      </Pressable>
    </View>
  );
}
