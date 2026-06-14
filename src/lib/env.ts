type RawEnv = Record<string, string | undefined>;

export function readEnv(raw: RawEnv = process.env as RawEnv) {
  const supabaseUrl = raw.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseKey = raw.EXPO_PUBLIC_SUPABASE_KEY;
  if (!supabaseUrl) throw new Error('Variable manquante : EXPO_PUBLIC_SUPABASE_URL');
  if (!supabaseKey) throw new Error('Variable manquante : EXPO_PUBLIC_SUPABASE_KEY');
  return { supabaseUrl, supabaseKey };
}

let _env: ReturnType<typeof readEnv> | undefined;

export function getEnv() {
  if (!_env) _env = readEnv();
  return _env;
}
