import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../../src/features/auth/session-provider';
import { useMatches } from '../../src/features/matches/use-matches';
import { formatCountdown, isExpired } from '../../src/features/matches/countdown';
import { useMessages, useSendMessage } from '../../src/features/chat/use-chat';
import { MessageBubble } from '../../src/features/chat/MessageBubble';
import { ChatInput } from '../../src/features/chat/ChatInput';
import { SafetyMenu } from '../../src/features/safety/SafetyMenu';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../../src/components/EmptyState';
import { Colors } from '../../src/lib/theme';

const TEN_MIN_MS = 10 * 60 * 1000;

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = id as string;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const myId = session?.user.id;

  const { data: matches, isLoading: matchesLoading } = useMatches();
  const match = (matches ?? []).find((m) => m.match_id === matchId);

  const { data: messages = [], isLoading: messagesLoading } = useMessages(matchId);
  const send = useSendMessage(matchId);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Session ou liste des matchs encore en cours de chargement.
  if (!myId || matchesLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  // Matchs chargés mais celui-ci est absent (bloqué, expiré et purgé, ou supprimé) :
  // on évite le spinner infini en affichant un état clair (+ bouton retour via l'en-tête).
  if (!match) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Stack.Screen options={{ headerShown: true, title: 'Conversation' }} />
        <Text style={{ textAlign: 'center', color: Colors.textMuted }}>Conversation indisponible.</Text>
      </View>
    );
  }

  // Match présent : messages encore en cours de premier chargement.
  if (messagesLoading && messages.length === 0) {
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ color: expired ? Colors.textFaint : under10 ? Colors.danger : Colors.primary, fontWeight: '600' }}>
                {expired ? 'Expiré' : `⏳ ${formatCountdown(expiresAt, now)}`}
              </Text>
              <SafetyMenu
                targetId={match.other_id}
                tint="#333"
                onActionDone={() => router.back()}
              />
            </View>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
      >
        {messages.length === 0 ? (
          <EmptyState title="Aucun message" message="Lance la conversation !" />
        ) : (
          <FlatList
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 12 }}
            inverted
            data={[...messages].reverse()}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <MessageBubble message={item} mine={item.sender_id === myId} />}
          />
        )}
        {expired ? (
          <View style={{ padding: 16, backgroundColor: Colors.bgMuted }}>
            <Text style={{ textAlign: 'center', color: Colors.textMuted }}>
              Ce match a expiré — tu ne peux plus envoyer de messages.
            </Text>
          </View>
        ) : (
          <ChatInput
            disabled={send.isPending}
            onSendText={(body) => send.mutate({ body })}
            onSendImage={(localUri) => send.mutate({ localUri })}
          />
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
