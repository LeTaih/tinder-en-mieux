import { isValidHeight, canAddInterest, validatePromptAnswer } from './rich-validation';

describe('rich-validation', () => {
  it('taille valide entre 120 et 230', () => {
    expect(isValidHeight(170)).toBe(true);
    expect(isValidHeight(119)).toBe(false);
    expect(isValidHeight(231)).toBe(false);
    expect(isValidHeight(null)).toBe(true);
  });
  it('plafond de 5 intérêts', () => {
    expect(canAddInterest(4)).toBe(true);
    expect(canAddInterest(5)).toBe(false);
  });
  it('réponse de prompt 1..200 non vide', () => {
    expect(validatePromptAnswer('Coucou')).toBeNull();
    expect(validatePromptAnswer('   ')).toBe('Réponse vide.');
    expect(validatePromptAnswer('x'.repeat(201))).toBe('200 caractères maximum.');
  });
});
