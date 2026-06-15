import { supabase } from '../../lib/supabase';

const SIGNED_URL_TTL_SECONDS = 60;

export async function signedPhotoUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('profile-photos')
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) return null;
  return data.signedUrl;
}
