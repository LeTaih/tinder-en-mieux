import { fireEvent, render, screen } from '@testing-library/react-native';
import { PromptEditor } from './PromptEditor';

const prompts = [{ id: 'p1', question: 'On matche si…' }, { id: 'p2', question: 'Le dimanche idéal…' }];

it('ajoute un prompt avec une réponse vide', () => {
  const onChange = jest.fn();
  render(<PromptEditor allPrompts={prompts} value={[]} onChange={onChange} />);
  fireEvent.press(screen.getByText('On matche si…'));
  expect(onChange).toHaveBeenCalledWith([{ promptId: 'p1', answer: '' }]);
});
