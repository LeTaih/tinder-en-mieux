import { formatCountdown, isExpired } from './countdown';

const base = new Date('2026-06-15T12:00:00Z');

test('formatCountdown mm:ss', () => {
  const future = new Date(base.getTime() + (59 * 60 + 32) * 1000).toISOString();
  expect(formatCountdown(future, base)).toBe('59:32');
});
test('formatCountdown pad minutes et secondes', () => {
  const future = new Date(base.getTime() + (5 * 60 + 3) * 1000).toISOString();
  expect(formatCountdown(future, base)).toBe('05:03');
});
test('formatCountdown expiré', () => {
  const past = new Date(base.getTime() - 1000).toISOString();
  expect(formatCountdown(past, base)).toBe('Expiré');
});
test('isExpired', () => {
  expect(isExpired(new Date(base.getTime() - 1).toISOString(), base)).toBe(true);
  expect(isExpired(new Date(base.getTime() + 1000).toISOString(), base)).toBe(false);
});
