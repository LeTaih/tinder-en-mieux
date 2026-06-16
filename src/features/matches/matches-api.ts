import { supabase } from '../../lib/supabase';
import type { RichProfileFields } from '../profile/rich-types';

export type Match = {
  match_id: string;
  other_id: string;
  display_name: string;
  photo: string | null;
  photos: string[];
  expires_at: string;
  is_active: boolean;
  location_label: string | null;
} & RichProfileFields;

export async function fetchMatches(): Promise<Match[]> {
  const { data, error } = await supabase.functions.invoke<{ matches: Match[] }>('get-matches', { body: {} });
  if (error) throw error;
  return data?.matches ?? [];
}
