export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isValidPassword(value: string): boolean {
  return value.length >= 8;
}

export type CredentialErrors = { email?: string; password?: string };

export function validateCredentials(email: string, password: string): CredentialErrors {
  const errors: CredentialErrors = {};
  if (!isValidEmail(email)) errors.email = 'Adresse e-mail invalide.';
  if (!isValidPassword(password)) errors.password = 'Le mot de passe doit faire au moins 8 caractères.';
  return errors;
}
