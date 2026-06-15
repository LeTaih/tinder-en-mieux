import * as ImageManipulator from 'expo-image-manipulator';
import { randomUUID } from 'expo-crypto';
import { supabase } from '../../lib/supabase';
import { PHOTO_COMPRESS, PHOTO_MAX_DIMENSION } from '../profile/image';
import type { Message } from './chat-format';

declare const atob: (s: string) => string;

const CHAT_BUCKET = 'chat-media';

export async function fetchMessages(matchId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, match_id, sender_id, body, image_path, created_at')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendText(matchId: string, body: string): Promise<Message> {
  const { data, error } = await supabase.rpc('send_message', {
    p_match_id: matchId,
    p_body: body,
    p_image_path: null,
  });
  if (error) throw error;
  return data as unknown as Message;
}

export async function sendImage(matchId: string, localUri: string): Promise<Message> {
  const manipulated = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: PHOTO_MAX_DIMENSION } }],
    { compress: PHOTO_COMPRESS, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!manipulated.base64) throw new Error('Compression échouée');
  const path = `${matchId}/${randomUUID()}.jpg`;
  const bytes = Uint8Array.from(atob(manipulated.base64), (c) => c.charCodeAt(0));
  const up = await supabase.storage.from(CHAT_BUCKET).upload(path, bytes, { contentType: 'image/jpeg' });
  if (up.error) throw up.error;
  const { data, error } = await supabase.rpc('send_message', {
    p_match_id: matchId,
    p_body: null,
    p_image_path: path,
  });
  if (error) throw error;
  return data as unknown as Message;
}
