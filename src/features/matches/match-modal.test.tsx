import { render, screen } from '@testing-library/react-native';
import { MatchModal } from './MatchModal';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('./use-matches', () => ({
  useMatches: () => ({
    data: [{ match_id: 'm1', other_id: 'o1', display_name: 'Brigitte', photo: 'https://x/p.jpg', expires_at: '', is_active: true }],
  }),
}));

test('affiche le titre et le prénom du match', () => {
  render(<MatchModal matchId="m1" onClose={jest.fn()} />);
  expect(screen.getByText("C'est un match !")).toBeTruthy();
  expect(screen.getByText(/Brigitte/)).toBeTruthy();
});
