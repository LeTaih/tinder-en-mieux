import { fireEvent, render, screen } from '@testing-library/react-native';
import Preferences from './preferences';

const mockPush = jest.fn();
const mockUpsert = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../src/features/auth/session-provider', () => ({
  useSession: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));
jest.mock('../../src/features/profile/use-profile', () => ({
  useGenders: () => ({ data: [] }),
}));
jest.mock('../../src/features/profile/profile-api', () => ({
  upsertPreferences: (...args: unknown[]) => mockUpsert(...args),
}));

beforeEach(() => { mockPush.mockClear(); mockUpsert.mockClear(); });

test('erreur si aucun genre recherché', () => {
  render(<Preferences />);
  fireEvent.press(screen.getByText('Continuer'));
  expect(screen.getByText('Choisis au moins un genre recherché.')).toBeTruthy();
  expect(mockUpsert).not.toHaveBeenCalled();
});
