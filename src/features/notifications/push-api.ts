import { supabase } from '../../lib/supabase';

export async function registerPushToken(token: string, platform: string): Promise<void> {
  // Passe par une RPC SECURITY DEFINER qui réattribue le token au compte courant
  // (un changement de compte sur le même appareil ne doit pas violer la RLS).
  const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: platform });
  if (error) throw error;
}

export async function clearBadge(): Promise<void> {
  await supabase.rpc('clear_badge');
}
