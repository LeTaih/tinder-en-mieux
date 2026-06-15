import { supabase } from '../../lib/supabase';

const CHAT_BUCKET = 'chat-media';
const SIGNED_URL_TTL_SECONDS = 120;

export async function signedChatImageUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) return null;
  return data.signedUrl;
}
