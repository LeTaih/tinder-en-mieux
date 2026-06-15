import { routeForNotification, type PushData } from './notification-format';

test('route vers le chat pour un message', () => {
  expect(routeForNotification({ type: 'message', matchId: 'm1' })).toBe('/match/m1');
});

test('route vers le chat pour un match', () => {
  expect(routeForNotification({ type: 'match', matchId: 'm2' })).toBe('/match/m2');
});

test('route vers le chat pour une expiration', () => {
  expect(routeForNotification({ type: 'expiring', matchId: 'm3' })).toBe('/match/m3');
});

test('null si données absentes ou incomplètes', () => {
  expect(routeForNotification(undefined)).toBeNull();
  expect(routeForNotification({} as PushData)).toBeNull();
  expect(routeForNotification({ type: 'message' })).toBeNull();
});
