import { fireEvent, render, screen } from '@testing-library/react-native';
import Identity from './identity';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../src/features/auth/session-provider', () => ({
  useSession: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));

beforeEach(() => mockPush.mockClear());

test('refuse un mineur et n\'avance pas', () => {
  render(<Identity />);
  fireEvent.changeText(screen.getByPlaceholderText('Prénom'), 'Léa');
  fireEvent.changeText(screen.getByPlaceholderText('Date de naissance (AAAA-MM-JJ)'), '2020-01-01');
  fireEvent.press(screen.getByText('Continuer'));
  expect(screen.getByText('Tu dois avoir au moins 18 ans.')).toBeTruthy();
  expect(mockPush).not.toHaveBeenCalled();
});

test('accepte un adulte et navigue vers genre', () => {
  render(<Identity />);
  fireEvent.changeText(screen.getByPlaceholderText('Prénom'), 'Léa');
  fireEvent.changeText(screen.getByPlaceholderText('Date de naissance (AAAA-MM-JJ)'), '1995-01-01');
  fireEvent.press(screen.getByText('Continuer'));
  expect(mockPush).toHaveBeenCalled();
});
