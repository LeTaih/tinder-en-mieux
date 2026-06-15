import { supabase } from '../../lib/supabase';

export async function registerPushToken(userId: string, token: string, platform: string): Promise<void> {
  const { error } = await supabase.from('push_tokens').upsert(
    { user_id: userId, token, platform, updated_at: new Date().toISOString() },
    { onConflict: 'token' },
  );
  if (error) throw error;
}

export async function clearBadge(): Promise<void> {
  await supabase.rpc('clear_badge');
}
