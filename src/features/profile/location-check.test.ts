import { isSignificantDrift, LOCATION_DRIFT_THRESHOLD_KM } from './location-check';

test('null (pas de position stockée) ne déclenche pas de proposition', () => {
  expect(isSignificantDrift(null)).toBe(false);
});

test('en deçà du seuil → pas de proposition', () => {
  expect(isSignificantDrift(LOCATION_DRIFT_THRESHOLD_KM - 1)).toBe(false);
  expect(isSignificantDrift(0)).toBe(false);
});

test('au seuil ou au-delà → proposition', () => {
  expect(isSignificantDrift(LOCATION_DRIFT_THRESHOLD_KM)).toBe(true);
  expect(isSignificantDrift(LOCATION_DRIFT_THRESHOLD_KM + 100)).toBe(true);
});

test('seuil personnalisé respecté', () => {
  expect(isSignificantDrift(40, 50)).toBe(false);
  expect(isSignificantDrift(50, 50)).toBe(true);
});
