import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { signedChatImageUrl } from './chat-image';
import { isImageMessage, type Message } from './chat-format';
import { Colors, Radii } from '../../lib/theme';

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
          <Image source={{ uri: imageUrl }} style={{ width: 200, height: 250, borderRadius: Radii.md }} />
        ) : (
          <View style={{ width: 200, height: 250, borderRadius: Radii.md, backgroundColor: Colors.borderLight }} />
        )}
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      <View
        style={{
          backgroundColor: mine ? Colors.primary : Colors.bubbleOther,
          borderRadius: Radii.lg,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <Text style={{ color: mine ? Colors.white : Colors.black }}>{message.body}</Text>
      </View>
    </View>
  );
}
