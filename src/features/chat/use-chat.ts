import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { fetchMessages, sendImage, sendText } from './chat-api';
import { expiresAtFromMessage, sortAndDedupe, type Message } from './chat-format';
import type { Match } from '../matches/matches-api';

// Le serveur a remis expires_at à now()+60min ; on reflète la même valeur dans le
// cache des matchs pour que le compte à rebours (écran + onglet) se mette à jour en direct.
function bumpMatchExpiry(qc: ReturnType<typeof useQueryClient>, matchId: string, createdAt: string) {
  qc.setQueryData<Match[]>(['matches'], (prev) =>
    (prev ?? []).map((m) =>
      m.match_id === matchId ? { ...m, expires_at: expiresAtFromMessage(createdAt), is_active: true } : m,
    ),
  );
}

export function useMessages(matchId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['messages', matchId],
    queryFn: () => fetchMessages(matchId),
  });

  useEffect(() => {
    const channel = supabase
      .channel(`messages:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` },
        (payload) => {
          const incoming = payload.new as Message;
          qc.setQueryData<Message[]>(['messages', matchId], (prev) =>
            sortAndDedupe([...(prev ?? []), incoming]),
          );
          bumpMatchExpiry(qc, matchId, incoming.created_at);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, qc]);

  return query;
}

export type SendInput = { body: string } | { localUri: string };

export function useSendMessage(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendInput) =>
      'body' in input ? sendText(matchId, input.body) : sendImage(matchId, input.localUri),
    onSuccess: (msg) => {
      // Rendu optimiste : on insère tout de suite (dédup par id avec l'écho Realtime).
      qc.setQueryData<Message[]>(['messages', matchId], (prev) => sortAndDedupe([...(prev ?? []), msg]));
      // Le timer a bougé : reflet instantané + refetch de réconciliation.
      bumpMatchExpiry(qc, matchId, msg.created_at);
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
    onError: () => {
      // Échec d'envoi (match expiré entre-temps, upload, réseau…) : pas de bulle fantôme.
      Alert.alert('Envoi impossible', "Le message n'a pas pu être envoyé. Réessaie.");
    },
  });
}
