import { fireEvent, render, screen } from '@testing-library/react-native';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('affiche titre et message', () => {
    render(<EmptyState title="Plus de profils" message="Reviens plus tard !" />);
    expect(screen.getByText('Plus de profils')).toBeTruthy();
    expect(screen.getByText('Reviens plus tard !')).toBeTruthy();
  });
  it("déclenche l'action quand fournie", () => {
    const onAction = jest.fn();
    render(<EmptyState title="Oups" actionLabel="Réessayer" onAction={onAction} />);
    fireEvent.press(screen.getByText('Réessayer'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
