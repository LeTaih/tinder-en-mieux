import { supabase } from '../../lib/supabase';

export type Interest = { id: string; label: string };
export type Prompt = { id: string; question: string };

export async function fetchInterests(): Promise<Interest[]> {
  const { data, error } = await supabase.from('interests').select('id, label').eq('is_active', true).order('sort_order');
  if (error) throw error;
  return data ?? [];
}
export async function fetchPrompts(): Promise<Prompt[]> {
  const { data, error } = await supabase.from('prompts').select('id, question').eq('is_active', true).order('sort_order');
  if (error) throw error;
  return data ?? [];
}
