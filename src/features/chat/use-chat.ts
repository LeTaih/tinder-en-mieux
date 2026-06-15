import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { fetchMessages, sendImage, sendText } from './chat-api';
import { sortAndDedupe, type Message } from './chat-format';

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
      // Le timer a bougé : rafraîchir la liste des matchs (compte à rebours).
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}
