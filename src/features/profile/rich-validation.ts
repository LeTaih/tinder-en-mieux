export const MAX_INTERESTS = 5;
export const MAX_PROMPTS = 3;
export const MAX_ANSWER = 200;
export const MIN_HEIGHT = 120;
export const MAX_HEIGHT = 230;

export function isValidHeight(cm: number | null): boolean {
  if (cm === null) return true;
  return Number.isInteger(cm) && cm >= MIN_HEIGHT && cm <= MAX_HEIGHT;
}

export function canAddInterest(currentCount: number): boolean {
  return currentCount < MAX_INTERESTS;
}

export function validatePromptAnswer(answer: string): string | null {
  const t = answer.trim();
  if (t.length === 0) return 'Réponse vide.';
  if (answer.length > MAX_ANSWER) return `${MAX_ANSWER} caractères maximum.`;
  return null;
}
