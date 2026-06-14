import { isValidEmail } from './validation';

test('isValidEmail accepte une adresse valide', () => {
  expect(isValidEmail('a@b.co')).toBe(true);
});
