import { formatPlaceLabel } from './geocode';

test('renvoie la ville quand disponible', () => {
  expect(formatPlaceLabel({ city: 'Paris', region: 'Île-de-France' } as any)).toBe('Paris');
});

test('retombe sur subregion puis region', () => {
  expect(formatPlaceLabel({ city: null, subregion: 'Rhône', region: 'AURA' } as any)).toBe('Rhône');
  expect(formatPlaceLabel({ city: null, subregion: null, region: 'Bretagne' } as any)).toBe('Bretagne');
});

test('null/vide → null', () => {
  expect(formatPlaceLabel(undefined)).toBeNull();
  expect(formatPlaceLabel(null)).toBeNull();
  expect(formatPlaceLabel({ city: '  ', subregion: null, region: null } as any)).toBeNull();
});

test('rogne les espaces', () => {
  expect(formatPlaceLabel({ city: '  Lyon  ' } as any)).toBe('Lyon');
});
