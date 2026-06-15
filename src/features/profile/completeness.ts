export type CompletenessInput = {
  profile: {
    display_name: string | null;
    birthdate: string | null;
    gender_id: string | null;
    location: unknown;
  } | null;
  photosCount: number;
  preferences: { age_min: number; age_max: number; max_distance_km: number } | null;
  seekingGenderCount: number;
};

export function isProfileComplete(input: CompletenessInput): boolean {
  const p = input.profile;
  if (!p) return false;
  if (!p.display_name || p.display_name.trim().length === 0) return false;
  if (!p.birthdate) return false;
  if (!p.gender_id) return false;
  if (!p.location) return false;
  if (input.photosCount < 1) return false;
  if (!input.preferences) return false;
  if (input.seekingGenderCount < 1) return false;
  return true;
}
