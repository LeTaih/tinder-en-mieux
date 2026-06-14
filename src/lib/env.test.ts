import { readEnv } from './env';

test('readEnv renvoie les valeurs présentes', () => {
  expect(readEnv({ EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', EXPO_PUBLIC_SUPABASE_KEY: 'k' }))
    .toEqual({ supabaseUrl: 'https://x.supabase.co', supabaseKey: 'k' });
});

test('readEnv lève une erreur si une variable manque', () => {
  expect(() => readEnv({ EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' }))
    .toThrow('EXPO_PUBLIC_SUPABASE_KEY');
});
