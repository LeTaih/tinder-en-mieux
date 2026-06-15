import { supabase } from '../../lib/supabase';

export type DeckCandidate = {
  id: string;
  display_name: string;
  age: number;
  distance_km: number;
  bio: string | null;
  photos: string[];
};

export async function fetchDeck(limit = 10, offset = 0): Promise<DeckCandidate[]> {
  const { data, error } = await supabase.functions.invoke<{ candidates: DeckCandidate[] }>('get-deck', {
    body: { limit, offset },
  });
  if (error) throw error;
  return data?.candidates ?? [];
}

export type SwipeResult = { likesRemaining: number; matched: boolean; matchId: string | null };

export async function recordSwipe(target: string, direction: 'like' | 'pass'): Promise<SwipeResult> {
  const { data, error } = await supabase.rpc('record_swipe', { p_target: target, p_direction: direction });
  if (error) throw error;
  // record_swipe est typée `Json` (générée) : on caste vers la forme renvoyée par la RPC.
  const res = data as { likes_remaining?: number; matched?: boolean; match_id?: string | null } | null;
  return {
    likesRemaining: res?.likes_remaining ?? 0,
    matched: res?.matched ?? false,
    matchId: res?.match_id ?? null,
  };
}

export async function rewindLastSwipe(): Promise<string | null> {
  const { data, error } = await supabase.rpc('rewind_last_swipe');
  if (error) throw error;
  return (data as string) ?? null;
}

export async function likesRemaining(): Promise<number> {
  const { data, error } = await supabase.rpc('likes_remaining_today');
  if (error) throw error;
  return (data as number) ?? 0;
}
