import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SIGNED_URL_TTL = 120;

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return new Response('Unauthorized', { status: 401 });

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: rows, error } = await service.rpc('my_matches', { p_user: userData.user.id });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const matches = [] as Array<{
    match_id: string; other_id: string; display_name: string;
    photo: string | null; expires_at: string; is_active: boolean;
  }>;
  for (const r of rows ?? []) {
    let photo: string | null = null;
    if (r.photo_path) {
      const { data: signed } = await service.storage.from('profile-photos').createSignedUrl(r.photo_path, SIGNED_URL_TTL);
      photo = signed?.signedUrl ?? null;
    }
    matches.push({
      match_id: r.match_id, other_id: r.other_id, display_name: r.display_name,
      photo, expires_at: r.expires_at, is_active: r.is_active,
    });
  }

  return new Response(JSON.stringify({ matches }), { headers: { 'Content-Type': 'application/json' } });
});
