import { isValidEmail, isValidPassword, validateCredentials } from './validation';

test('isValidEmail accepte une adresse valide', () => {
  expect(isValidEmail('a@b.co')).toBe(true);
});

test('isValidEmail rejette une adresse sans domaine', () => {
  expect(isValidEmail('a@b')).toBe(false);
});

test('isValidPassword exige au moins 8 caractères', () => {
  expect(isValidPassword('1234567')).toBe(false);
  expect(isValidPassword('12345678')).toBe(true);
});

test('validateCredentials renvoie les erreurs par champ', () => {
  expect(validateCredentials('bad', 'short')).toEqual({
    email: 'Adresse e-mail invalide.',
    password: 'Le mot de passe doit faire au moins 8 caractères.',
  });
  expect(validateCredentials('a@b.co', '12345678')).toEqual({});
});
