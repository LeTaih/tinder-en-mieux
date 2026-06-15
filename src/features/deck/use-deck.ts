import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchDeck, likesRemaining, recordSwipe, rewindLastSwipe } from './deck-api';

export function useDeck() {
  return useQuery({ queryKey: ['deck'], queryFn: () => fetchDeck(10, 0) });
}

export function useLikesRemaining() {
  return useQuery({ queryKey: ['likes-remaining'], queryFn: likesRemaining });
}

export function useSwipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ target, direction }: { target: string; direction: 'like' | 'pass' }) =>
      recordSwipe(target, direction),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['likes-remaining'] });
    },
  });
}

export function useRewind() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rewindLastSwipe,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['likes-remaining'] });
      qc.invalidateQueries({ queryKey: ['deck'] });
    },
  });
}
