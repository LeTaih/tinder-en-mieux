import { render, screen } from '@testing-library/react-native';
import { ErrorText } from './ErrorText';

describe('ErrorText', () => {
  it('affiche le message', () => {
    render(<ErrorText message="Champ requis" />);
    expect(screen.getByText('Champ requis')).toBeTruthy();
  });
  it('ne rend rien si vide', () => {
    const { toJSON } = render(<ErrorText message={undefined} />);
    expect(toJSON()).toBeNull();
  });
});
