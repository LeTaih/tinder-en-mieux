import { supabase } from '../../lib/supabase';

export type GenderRow = { id: string; key: string; label: string };

export async function fetchActiveGenders(): Promise<GenderRow[]> {
  const { data, error } = await supabase
    .from('genders')
    .select('id, key, label')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

export async function upsertIdentity(
  userId: string,
  fields: { display_name: string; birthdate: string; gender_id: string; bio?: string | null },
) {
  const { error } = await supabase.from('profiles').upsert({ id: userId, ...fields });
  if (error) throw error;
}

export async function insertPhoto(userId: string, storagePath: string, position: number) {
  const { error } = await supabase
    .from('profile_photos')
    .insert({ profile_id: userId, storage_path: storagePath, position });
  if (error) throw error;
}

export async function deletePhoto(userId: string, photoId: string, storagePath: string) {
  await supabase.storage.from('profile-photos').remove([storagePath]);
  const { error } = await supabase.from('profile_photos').delete().eq('id', photoId).eq('profile_id', userId);
  if (error) throw error;
}

export async function upsertPreferences(
  prefs: { age_min: number; age_max: number; max_distance_km: number },
  seekingGenderIds: string[],
) {
  const { error } = await supabase.rpc('set_my_preferences', {
    p_age_min: prefs.age_min,
    p_age_max: prefs.age_max,
    p_max_distance_km: prefs.max_distance_km,
    p_gender_ids: seekingGenderIds,
  });
  if (error) throw error;
}

export async function setMyLocation(lng: number, lat: number, label?: string | null) {
  const { error } = await supabase.rpc('set_my_location', {
    lng,
    lat,
    ...(label != null ? { label } : {}),
  });
  if (error) throw error;
}

// Distance (km) entre un point et ma position stockée, calculée côté serveur.
// Ne renvoie jamais mes coordonnées. null si je n'ai pas encore de position.
export async function locationDriftKm(lng: number, lat: number): Promise<number | null> {
  const { data, error } = await supabase.rpc('location_drift_km', { lng, lat });
  if (error) throw error;
  return (data as number | null) ?? null;
}

export async function setMyInterests(interestIds: string[]) {
  const { error } = await supabase.rpc('set_my_interests', { p_interest_ids: interestIds });
  if (error) throw error;
}

export async function setMyPrompts(items: { promptId: string; answer: string }[]) {
  const { error } = await supabase.rpc('set_my_prompts', {
    p_prompt_ids: items.map((i) => i.promptId),
    p_answers: items.map((i) => i.answer),
  });
  if (error) throw error;
}

export async function updateMyProfileFields(
  userId: string,
  fields: { bio?: string | null; job?: string | null; education?: string | null; height_cm?: number | null },
) {
  const { error } = await supabase.from('profiles').update(fields).eq('id', userId);
  if (error) throw error;
}

export type MyProfileData = {
  profile: {
    display_name: string | null;
    birthdate: string | null;
    gender_id: string | null;
    bio: string | null;
    location: unknown;
    location_label: string | null;
    job: string | null;
    education: string | null;
    height_cm: number | null;
  } | null;
  photos: { id: string; storage_path: string; position: number }[];
  preferences: { age_min: number; age_max: number; max_distance_km: number } | null;
  seekingGenderIds: string[];
  interestIds: string[];
  promptItems: { promptId: string; answer: string }[];
};

export async function fetchMyProfile(userId: string): Promise<MyProfileData> {
  const [p, ph, pref, pg, pi, ppr] = await Promise.all([
    supabase.from('profiles').select('display_name, birthdate, gender_id, bio, location, location_label, job, education, height_cm').eq('id', userId).maybeSingle(),
    supabase.from('profile_photos').select('id, storage_path, position').eq('profile_id', userId).order('position'),
    supabase.from('preferences').select('age_min, age_max, max_distance_km').eq('profile_id', userId).maybeSingle(),
    supabase.from('preference_genders').select('gender_id').eq('profile_id', userId),
    supabase.from('profile_interests').select('interest_id').eq('profile_id', userId),
    supabase.from('profile_prompts').select('prompt_id, answer, position').eq('profile_id', userId).order('position'),
  ]);
  if (p.error) throw p.error;
  if (ph.error) throw ph.error;
  if (pref.error) throw pref.error;
  if (pg.error) throw pg.error;
  if (pi.error) throw pi.error;
  if (ppr.error) throw ppr.error;
  return {
    profile: p.data ?? null,
    photos: ph.data ?? [],
    preferences: pref.data ?? null,
    seekingGenderIds: (pg.data ?? []).map((r) => r.gender_id),
    interestIds: (pi.data ?? []).map((r) => r.interest_id),
    promptItems: (ppr.data ?? []).map((r) => ({ promptId: r.prompt_id, answer: r.answer })),
  };
}
