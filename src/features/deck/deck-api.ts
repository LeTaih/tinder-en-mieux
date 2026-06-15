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

export async function recordSwipe(target: string, direction: 'like' | 'pass'): Promise<number> {
  const { data, error } = await supabase.rpc('record_swipe', { p_target: target, p_direction: direction });
  if (error) throw error;
  return (data as number) ?? 0;
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
