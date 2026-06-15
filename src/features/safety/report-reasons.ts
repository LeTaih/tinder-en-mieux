export type ReportReason = 'spam' | 'inapproprie' | 'harcelement' | 'faux_profil' | 'autre';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'inapproprie', label: 'Contenu inapproprié' },
  { value: 'harcelement', label: 'Harcèlement' },
  { value: 'faux_profil', label: 'Faux profil' },
  { value: 'autre', label: 'Autre' },
];

const BY_VALUE = new Map<string, string>(REPORT_REASONS.map((r) => [r.value, r.label]));

export function isValidReason(value: string): value is ReportReason {
  return BY_VALUE.has(value);
}

export function labelForReason(value: ReportReason): string {
  return BY_VALUE.get(value) ?? value;
}
