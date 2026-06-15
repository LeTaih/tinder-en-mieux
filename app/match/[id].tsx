import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../src/features/auth/session-provider';
import { useMatches } from '../../src/features/matches/use-matches';
import { formatCountdown, isExpired } from '../../src/features/matches/countdown';
import { useMessages, useSendMessage } from '../../src/features/chat/use-chat';
import { MessageBubble } from '../../src/features/chat/MessageBubble';
import { ChatInput } from '../../src/features/chat/ChatInput';

const TEN_MIN_MS = 10 * 60 * 1000;

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = id as string;
  const { session } = useSession();
  const myId = session?.user.id;

  const { data: matches } = useMatches();
  const match = (matches ?? []).find((m) => m.match_id === matchId);

  const { data: messages = [], isLoading } = useMessages(matchId);
  const send = useSendMessage(matchId);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!match || !myId || (isLoading && messages.length === 0)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  // `match.expires_at` est l'autorité serveur (bumpée en direct par use-chat à chaque message).
  const expiresAt = match.expires_at;
  const expired = isExpired(expiresAt, now);
  const remainingMs = new Date(expiresAt).getTime() - now.getTime();
  const under10 = !expired && remainingMs < TEN_MIN_MS;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: match.display_name,
          headerRight: () => (
            <Text style={{ color: expired ? '#999' : under10 ? '#E53935' : '#208AEF', fontWeight: '600' }}>
              {expired ? 'Expiré' : `⏳ ${formatCountdown(expiresAt, now)}`}
            </Text>
          ),
        }}
      />
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12 }}
        inverted
        data={[...messages].reverse()}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} mine={item.sender_id === myId} />}
      />
      {expired ? (
        <View style={{ padding: 16, backgroundColor: '#f2f2f2' }}>
          <Text style={{ textAlign: 'center', color: '#777' }}>
            Ce match a expiré — tu ne peux plus envoyer de messages.
          </Text>
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ChatInput
            disabled={send.isPending}
            onSendText={(body) => send.mutate({ body })}
            onSendImage={(localUri) => send.mutate({ localUri })}
          />
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
