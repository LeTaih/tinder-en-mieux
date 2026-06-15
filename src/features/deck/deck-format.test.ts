import { formatDistance, formatAge, clampRemaining } from './deck-format';

test('formatDistance', () => {
  expect(formatDistance(0)).toBe('à moins de 1 km');
  expect(formatDistance(1)).toBe('à 1 km');
  expect(formatDistance(12)).toBe('à 12 km');
});
test('formatAge', () => {
  expect(formatAge(24)).toBe('24 ans');
});
test('clampRemaining ne descend jamais sous 0', () => {
  expect(clampRemaining(5)).toBe(5);
  expect(clampRemaining(-3)).toBe(0);
});
