import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppButton } from './AppButton';

describe('AppButton', () => {
  it('affiche le titre et déclenche onPress', () => {
    const onPress = jest.fn();
    render(<AppButton title="Se connecter" onPress={onPress} />);
    fireEvent.press(screen.getByText('Se connecter'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('en chargement : masque le titre et ignore le press', () => {
    const onPress = jest.fn();
    render(<AppButton title="Se connecter" onPress={onPress} loading />);
    expect(screen.queryByText('Se connecter')).toBeNull();
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });
  it('désactivé : ignore le press', () => {
    const onPress = jest.fn();
    render(<AppButton title="Continuer" onPress={onPress} disabled />);
    fireEvent.press(screen.getByText('Continuer'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
