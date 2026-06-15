import { REPORT_REASONS, isValidReason, labelForReason } from './report-reasons';

describe('report-reasons', () => {
  it('expose les 5 motifs dans l\'ordre attendu', () => {
    expect(REPORT_REASONS.map((r) => r.value)).toEqual([
      'spam',
      'inapproprie',
      'harcelement',
      'faux_profil',
      'autre',
    ]);
  });

  it('valide les motifs connus et rejette les inconnus', () => {
    expect(isValidReason('spam')).toBe(true);
    expect(isValidReason('faux_profil')).toBe(true);
    expect(isValidReason('n_importe_quoi')).toBe(false);
    expect(isValidReason('')).toBe(false);
  });

  it('renvoie le libellé FR du motif', () => {
    expect(labelForReason('harcelement')).toBe('Harcèlement');
    expect(labelForReason('inapproprie')).toBe('Contenu inapproprié');
  });
});
