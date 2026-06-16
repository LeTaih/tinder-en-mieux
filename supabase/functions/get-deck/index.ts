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
  const userId = userData.user.id;

  let limit = 10;
  let offset = 0;
  try {
    const body = await req.json();
    if (typeof body?.limit === 'number') limit = Math.min(Math.max(body.limit, 1), 30);
    if (typeof body?.offset === 'number') offset = Math.max(body.offset, 0);
  } catch (_e) {
    // valeurs par défaut
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: rows, error } = await service.rpc('deck_candidates', {
    p_user: userId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const candidates = [] as Array<{
    id: string; display_name: string; age: number; distance_km: number; bio: string | null; photos: string[];
    job: string | null; education: string | null; height_cm: number | null; interests: string[]; prompts: unknown;
    location_label: string | null;
  }>;
  for (const r of rows ?? []) {
    const paths: string[] = r.photo_paths ?? [];
    let photos: string[] = [];
    if (paths.length > 0) {
      const { data: signed } = await service.storage.from('profile-photos').createSignedUrls(paths, SIGNED_URL_TTL);
      photos = (signed ?? []).map((s) => s.signedUrl).filter(Boolean) as string[];
    }
    candidates.push({
      id: r.id, display_name: r.display_name, age: r.age, distance_km: r.distance_km, bio: r.bio, photos,
      job: r.job ?? null, education: r.education ?? null, height_cm: r.height_cm ?? null,
      interests: r.interests ?? [], prompts: r.prompts ?? [], location_label: r.location_label ?? null,
    });
  }

  return new Response(JSON.stringify({ candidates }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
