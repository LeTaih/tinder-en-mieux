import { supabase } from '../../lib/supabase';

export type Match = {
  match_id: string;
  other_id: string;
  display_name: string;
  photo: string | null;
  expires_at: string;
  is_active: boolean;
};

export async function fetchMatches(): Promise<Match[]> {
  const { data, error } = await supabase.functions.invoke<{ matches: Match[] }>('get-matches', { body: {} });
  if (error) throw error;
  return data?.matches ?? [];
}
