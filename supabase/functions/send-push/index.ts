import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET = Deno.env.get('INTERNAL_PUSH_SECRET')!;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async (req) => {
  if (req.headers.get('x-internal-secret') !== INTERNAL_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  // Corps malformé/vide -> dégrade proprement en { sent: 0 } (pas de 500).
  const payload = await req.json().catch(() => ({}));
  const { user_ids, title, body, data } = payload;
  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } });
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const messages: Array<Record<string, unknown>> = [];
  for (const userId of user_ids) {
    const { data: tokens } = await service.from('push_tokens').select('token').eq('user_id', userId);
    if (!tokens || tokens.length === 0) continue;
    const { data: badge } = await service.rpc('increment_badge', { p_user: userId });
    for (const t of tokens) {
      messages.push({ to: t.token, title, body, data: data ?? {}, badge: badge ?? undefined, sound: 'default' });
    }
  }

  if (messages.length > 0) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
  }

  return new Response(JSON.stringify({ sent: messages.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
