import { useQuery } from '@tanstack/react-query';
import { fetchMatches } from './matches-api';

export function useMatches() {
  // Poll léger : sans realtime/push (Plan 6), le compte à rebours de la liste
  // resterait figé pour le destinataire jusqu'à un refetch.
  return useQuery({ queryKey: ['matches'], queryFn: fetchMatches, refetchInterval: 30_000 });
}
