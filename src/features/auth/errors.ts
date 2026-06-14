const MAP: Record<string, string> = {
  'Invalid login credentials': 'E-mail ou mot de passe incorrect.',
  'User already registered': 'Un compte existe déjà avec cet e-mail.',
  'Email not confirmed': 'Confirme ton e-mail avant de te connecter.',
};

const GENERIC = 'Une erreur est survenue. Réessaie.';

export function authErrorMessage(message?: string | null): string {
  if (!message) return GENERIC;
  return MAP[message] ?? GENERIC;
}
