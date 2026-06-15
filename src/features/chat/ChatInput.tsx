import { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

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
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 }}>
      <Pressable onPress={pickImage} disabled={disabled} hitSlop={8}>
        <Text style={{ fontSize: 22 }}>📎</Text>
      </Pressable>
      <TextInput
        style={{
          flex: 1,
          borderWidth: 1,
          borderColor: '#ddd',
          borderRadius: 20,
          paddingHorizontal: 14,
          paddingVertical: 8,
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
        style={{
          backgroundColor: '#208AEF',
          opacity: canSend ? 1 : 0.4,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: 20,
        }}
      >
        <Text style={{ color: 'white', fontSize: 18 }}>➤</Text>
      </Pressable>
    </View>
  );
}
