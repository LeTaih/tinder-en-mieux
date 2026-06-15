import { isProfileComplete } from './completeness';

const base = {
  profile: { display_name: 'Léa', birthdate: '2000-01-01', gender_id: 'g1', location: '0101...' as string | null },
  photosCount: 1,
  preferences: { age_min: 18, age_max: 40, max_distance_km: 50 } as null | { age_min: number; age_max: number; max_distance_km: number },
  seekingGenderCount: 1,
};

test('profil complet => true', () => {
  expect(isProfileComplete(base)).toBe(true);
});
test('sans photo => false', () => {
  expect(isProfileComplete({ ...base, photosCount: 0 })).toBe(false);
});
test('sans position => false', () => {
  expect(isProfileComplete({ ...base, profile: { ...base.profile, location: null } })).toBe(false);
});
test('sans préférences ou sans genre recherché => false', () => {
  expect(isProfileComplete({ ...base, preferences: null })).toBe(false);
  expect(isProfileComplete({ ...base, seekingGenderCount: 0 })).toBe(false);
});
test('champs identité manquants => false', () => {
  expect(isProfileComplete({ ...base, profile: { ...base.profile, display_name: '' } })).toBe(false);
  expect(isProfileComplete({ ...base, profile: { ...base.profile, birthdate: null } })).toBe(false);
  expect(isProfileComplete({ ...base, profile: { ...base.profile, gender_id: null } })).toBe(false);
});
