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
  userId: string,
  prefs: { age_min: number; age_max: number; max_distance_km: number },
  seekingGenderIds: string[],
) {
  const { error: e1 } = await supabase.from('preferences').upsert({ profile_id: userId, ...prefs });
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('preference_genders').delete().eq('profile_id', userId);
  if (e2) throw e2;
  if (seekingGenderIds.length > 0) {
    const rows = seekingGenderIds.map((gid) => ({ profile_id: userId, gender_id: gid }));
    const { error: e3 } = await supabase.from('preference_genders').insert(rows);
    if (e3) throw e3;
  }
}

export async function setMyLocation(lng: number, lat: number) {
  const { error } = await supabase.rpc('set_my_location', { lng, lat });
  if (error) throw error;
}

export type MyProfileData = {
  profile: {
    display_name: string | null;
    birthdate: string | null;
    gender_id: string | null;
    bio: string | null;
    location: string | null;
  } | null;
  photos: { id: string; storage_path: string; position: number }[];
  preferences: { age_min: number; age_max: number; max_distance_km: number } | null;
  seekingGenderIds: string[];
};

export async function fetchMyProfile(userId: string): Promise<MyProfileData> {
  const [p, ph, pref, pg] = await Promise.all([
    supabase.from('profiles').select('display_name, birthdate, gender_id, bio, location').eq('id', userId).maybeSingle(),
    supabase.from('profile_photos').select('id, storage_path, position').eq('profile_id', userId).order('position'),
    supabase.from('preferences').select('age_min, age_max, max_distance_km').eq('profile_id', userId).maybeSingle(),
    supabase.from('preference_genders').select('gender_id').eq('profile_id', userId),
  ]);
  if (p.error) throw p.error;
  if (ph.error) throw ph.error;
  if (pref.error) throw pref.error;
  if (pg.error) throw pg.error;
  return {
    profile: p.data ?? null,
    photos: ph.data ?? [],
    preferences: pref.data ?? null,
    seekingGenderIds: (pg.data ?? []).map((r) => r.gender_id),
  };
}
