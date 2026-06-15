import { fireEvent, render, screen } from '@testing-library/react-native';
import { InterestSelector } from './InterestSelector';

const all = [{ id: 'a', label: 'Sport' }, { id: 'b', label: 'Voyage' }];

it('sélectionne et désélectionne', () => {
  const onChange = jest.fn();
  render(<InterestSelector all={all} selectedIds={[]} onChange={onChange} />);
  fireEvent.press(screen.getByText('Sport'));
  expect(onChange).toHaveBeenCalledWith(['a']);
});

it('respecte le plafond de 5', () => {
  const onChange = jest.fn();
  render(<InterestSelector all={all} selectedIds={['a','b','c','d','e']} onChange={onChange} />);
  fireEvent.press(screen.getByText('Voyage'));
  expect(onChange).not.toHaveBeenCalled();
});
