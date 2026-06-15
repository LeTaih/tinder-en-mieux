import { fireEvent, render, screen } from '@testing-library/react-native';
import { ProfileDetailModal } from './ProfileDetailModal';

const data = {
  display_name: 'Léa', age: 24, distance_km: 3, bio: 'Salut', photos: ['https://x/p.jpg'],
  job: 'Designer', education: 'Beaux-Arts', height_cm: 168,
  interests: ['Sport', 'Voyage'],
  prompts: [{ question: 'On matche si…', answer: 'tu aimes la rando' }],
};

it('affiche infos riches + prompts et ferme', () => {
  const onClose = jest.fn();
  render(<ProfileDetailModal data={data} onClose={onClose} />);
  expect(screen.getByText('Léa, 24 ans')).toBeTruthy();
  expect(screen.getByText('Designer')).toBeTruthy();
  expect(screen.getByText('Sport')).toBeTruthy();
  expect(screen.getByText('On matche si…')).toBeTruthy();
  expect(screen.getByText('tu aimes la rando')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Fermer'));
  expect(onClose).toHaveBeenCalled();
});
