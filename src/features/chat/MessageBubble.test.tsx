import { render, screen } from '@testing-library/react-native';
import { MessageBubble } from './MessageBubble';
import type { Message } from './chat-format';

jest.mock('./chat-image', () => ({ signedChatImageUrl: jest.fn().mockResolvedValue(null) }));

function msg(over: Partial<Message>): Message {
  return {
    id: 'x', match_id: 'm', sender_id: 'u',
    body: 'Coucou', image_path: null, created_at: '2026-06-15T12:00:00.000Z',
    ...over,
  };
}

test('affiche le texte d\'un message texte', () => {
  render(<MessageBubble message={msg({})} mine={false} />);
  expect(screen.getByText('Coucou')).toBeTruthy();
});

test('un message image n\'affiche pas de texte', () => {
  render(<MessageBubble message={msg({ body: null, image_path: 'm/a.jpg' })} mine />);
  expect(screen.queryByText('Coucou')).toBeNull();
});
