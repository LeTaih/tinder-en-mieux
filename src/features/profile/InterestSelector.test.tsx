import { fireEvent, render, screen } from '@testing-library/react-native';
import { InterestSelector } from './InterestSelector';

const all = [{ id: 'a', label: 'Sport' }, { id: 'b', label: 'Voyage' }];

it('sélectionne un intérêt non sélectionné', () => {
  const onChange = jest.fn();
  render(<InterestSelector all={all} selectedIds={[]} onChange={onChange} />);
  fireEvent.press(screen.getByText('Sport'));
  expect(onChange).toHaveBeenCalledWith(['a']);
});

it('désélection toujours possible, même au plafond de 5', () => {
  const onChange = jest.fn();
  render(<InterestSelector all={all} selectedIds={['a', 'x1', 'x2', 'x3', 'x4']} onChange={onChange} />);
  fireEvent.press(screen.getByText('Sport')); // 'a' est sélectionné -> déselection autorisée
  expect(onChange).toHaveBeenCalledWith(['x1', 'x2', 'x3', 'x4']);
});

it('ajout bloqué quand le plafond de 5 est atteint', () => {
  const onChange = jest.fn();
  render(<InterestSelector all={all} selectedIds={['x1', 'x2', 'x3', 'x4', 'x5']} onChange={onChange} />);
  fireEvent.press(screen.getByText('Sport')); // 'a' non sélectionné, plafond atteint -> aucun changement
  expect(onChange).not.toHaveBeenCalled();
});
