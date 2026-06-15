import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { signedChatImageUrl } from './chat-image';
import { isImageMessage, type Message } from './chat-format';

export function MessageBubble({ message, mine }: { message: Message; mine: boolean }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (message.image_path) {
      signedChatImageUrl(message.image_path).then((url) => {
        if (!cancelled) setImageUrl(url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [message.image_path]);

  const containerStyle = {
    alignSelf: (mine ? 'flex-end' : 'flex-start') as 'flex-end' | 'flex-start',
    maxWidth: '78%' as const,
    marginVertical: 4,
  };

  if (isImageMessage(message)) {
    return (
      <View style={containerStyle}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width: 200, height: 250, borderRadius: 12 }} />
        ) : (
          <View style={{ width: 200, height: 250, borderRadius: 12, backgroundColor: '#ddd' }} />
        )}
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      <View
        style={{
          backgroundColor: mine ? '#208AEF' : '#E9E9EB',
          borderRadius: 16,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <Text style={{ color: mine ? 'white' : 'black' }}>{message.body}</Text>
      </View>
    </View>
  );
}
