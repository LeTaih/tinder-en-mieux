import { PHOTO_MAX_DIMENSION, PHOTO_COMPRESS, photoStoragePath } from './image';

test('constantes de compression raisonnables', () => {
  expect(PHOTO_MAX_DIMENSION).toBe(1080);
  expect(PHOTO_COMPRESS).toBeGreaterThan(0);
  expect(PHOTO_COMPRESS).toBeLessThanOrEqual(1);
});
test('photoStoragePath préfixe par userId et finit en .jpg', () => {
  expect(photoStoragePath('user-123', 'abc')).toBe('user-123/abc.jpg');
});
