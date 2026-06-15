import { fireEvent, render, screen } from '@testing-library/react-native';
import Preferences from '../../../app/(onboarding)/preferences';

const mockPush = jest.fn();
const mockUpsert = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../auth/session-provider', () => ({
  useSession: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));
jest.mock('./use-profile', () => ({
  useGenders: () => ({ data: [] }),
}));
jest.mock('./profile-api', () => ({
  upsertPreferences: (...args: unknown[]) => mockUpsert(...args),
}));

beforeEach(() => { mockPush.mockClear(); mockUpsert.mockClear(); });

test('erreur si aucun genre recherché', () => {
  render(<Preferences />);
  fireEvent.press(screen.getByText('Continuer'));
  expect(screen.getByText('Choisis au moins un genre recherché.')).toBeTruthy();
  expect(mockUpsert).not.toHaveBeenCalled();
});
