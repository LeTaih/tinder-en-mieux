import { render, screen, act } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SessionProvider, useSession } from './session-provider';

let authCallback: (event: string, session: unknown) => void = () => {};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  },
}));

function Probe() {
  const { session, loading } = useSession();
  return <Text>{loading ? 'loading' : session ? 'in' : 'out'}</Text>;
}

test('expose loading puis l\'état de session', async () => {
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  // après résolution de getSession -> "out"
  expect(await screen.findByText('out')).toBeTruthy();

  await act(async () => {
    authCallback('SIGNED_IN', { user: { id: '1' } });
  });
  expect(screen.getByText('in')).toBeTruthy();
});
