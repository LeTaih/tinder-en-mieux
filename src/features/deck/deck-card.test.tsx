import { fireEvent, render, screen } from '@testing-library/react-native';
import { DeckCard } from './DeckCard';

// On isole DeckCard : ce test ne couvre pas SafetyMenu (qui importe supabase via ses hooks).
jest.mock('../safety/SafetyMenu', () => ({ SafetyMenu: () => null }));

const candidate = { id: 'c1', display_name: 'Léa', age: 24, distance_km: 3, bio: 'Salut', photos: ['https://x/p.jpg'], job: null, education: null, height_cm: null, interests: [], prompts: [] };

test('affiche prénom, âge et distance', () => {
  render(<DeckCard candidate={candidate} likesRemaining={5} onLike={jest.fn()} onPass={jest.fn()} onRewind={jest.fn()} />);
  expect(screen.getByText('Léa, 24 ans')).toBeTruthy();
  expect(screen.getByText('à 3 km')).toBeTruthy();
});

test('like désactivé quand quota épuisé', () => {
  const onLike = jest.fn();
  render(<DeckCard candidate={candidate} likesRemaining={0} onLike={onLike} onPass={jest.fn()} onRewind={jest.fn()} />);
  fireEvent.press(screen.getByText('♥'));
  expect(onLike).not.toHaveBeenCalled();
});
