export function ageFromBirthdate(birthdate: string, now: Date): number {
  const b = new Date(birthdate);
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}
export function isAdult(birthdate: string, now: Date): boolean {
  return ageFromBirthdate(birthdate, now) >= 18;
}
export type PreferencesInput = {
  age_min: number; age_max: number; max_distance_km: number; seekingGenderCount: number;
};
export type PreferencesErrors = {
  age_min?: string; age_max?: string; max_distance_km?: string; seekingGenders?: string;
};
export function validatePreferences(input: PreferencesInput): PreferencesErrors {
  const e: PreferencesErrors = {};
  if (input.age_min < 18) e.age_min = "L'âge minimum doit être au moins 18 ans.";
  if (input.age_max < input.age_min) e.age_max = "L'âge maximum doit être supérieur ou égal au minimum.";
  if (input.max_distance_km <= 0) e.max_distance_km = 'La distance doit être supérieure à 0.';
  if (input.seekingGenderCount < 1) e.seekingGenders = 'Choisis au moins un genre recherché.';
  return e;
}
