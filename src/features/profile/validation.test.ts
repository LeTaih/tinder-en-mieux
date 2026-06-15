import { ageFromBirthdate, isAdult, validatePreferences } from './validation';

test('ageFromBirthdate calcule l\'âge à une date donnée', () => {
  expect(ageFromBirthdate('2000-06-15', new Date('2026-06-15'))).toBe(26);
  expect(ageFromBirthdate('2000-06-16', new Date('2026-06-15'))).toBe(25);
});
test('isAdult', () => {
  expect(isAdult('2008-06-16', new Date('2026-06-15'))).toBe(false);
  expect(isAdult('2008-06-15', new Date('2026-06-15'))).toBe(true);
});
test('validatePreferences', () => {
  expect(validatePreferences({ age_min: 18, age_max: 40, max_distance_km: 50, seekingGenderCount: 1 })).toEqual({});
  expect(validatePreferences({ age_min: 17, age_max: 40, max_distance_km: 50, seekingGenderCount: 1 }).age_min).toBeTruthy();
  expect(validatePreferences({ age_min: 30, age_max: 20, max_distance_km: 50, seekingGenderCount: 1 }).age_max).toBeTruthy();
  expect(validatePreferences({ age_min: 18, age_max: 40, max_distance_km: 0, seekingGenderCount: 1 }).max_distance_km).toBeTruthy();
  expect(validatePreferences({ age_min: 18, age_max: 40, max_distance_km: 50, seekingGenderCount: 0 }).seekingGenders).toBeTruthy();
});
