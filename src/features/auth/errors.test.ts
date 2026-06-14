import { authErrorMessage } from './errors';

test('messages connus traduits en français', () => {
  expect(authErrorMessage('Invalid login credentials')).toBe('E-mail ou mot de passe incorrect.');
  expect(authErrorMessage('User already registered')).toBe('Un compte existe déjà avec cet e-mail.');
});

test('message inconnu -> message générique', () => {
  expect(authErrorMessage('some unmapped error')).toBe('Une erreur est survenue. Réessaie.');
});

test('null/undefined -> message générique', () => {
  expect(authErrorMessage(undefined)).toBe('Une erreur est survenue. Réessaie.');
});
