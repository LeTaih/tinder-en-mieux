import { expiresAtFromMessage, isImageMessage, sortAndDedupe, type Message } from './chat-format';

function msg(over: Partial<Message>): Message {
  return {
    id: 'x',
    match_id: 'm',
    sender_id: 'u',
    body: 'hi',
    image_path: null,
    created_at: '2026-06-15T12:00:00.000Z',
    ...over,
  };
}

test('expiresAtFromMessage ajoute 60 minutes', () => {
  expect(expiresAtFromMessage('2026-06-15T12:00:00.000Z')).toBe('2026-06-15T13:00:00.000Z');
});

test('isImageMessage true si image_path renseigné', () => {
  expect(isImageMessage(msg({ body: null, image_path: 'm/a.jpg' }))).toBe(true);
  expect(isImageMessage(msg({ body: 'coucou', image_path: null }))).toBe(false);
});

test('sortAndDedupe trie par created_at croissant', () => {
  const a = msg({ id: 'a', created_at: '2026-06-15T12:00:02.000Z' });
  const b = msg({ id: 'b', created_at: '2026-06-15T12:00:01.000Z' });
  expect(sortAndDedupe([a, b]).map((m) => m.id)).toEqual(['b', 'a']);
});

test('sortAndDedupe enlève les doublons par id (garde le dernier vu)', () => {
  const a1 = msg({ id: 'a', body: 'v1' });
  const a2 = msg({ id: 'a', body: 'v2' });
  const out = sortAndDedupe([a1, a2]);
  expect(out).toHaveLength(1);
  expect(out[0].body).toBe('v2');
});
