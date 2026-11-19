import { useState } from 'react';
import { Rooms, type Room } from '../researcher/Operations';
import { Client } from '../researcher/client';
import { Button, Toolbar } from '../ui';
const fixture: Room = {
  id: 'room-version',
  room_id: 'room',
  revision: 1,
  expected_revision: 1,
  name: 'Laboratory',
  rows: 2,
  columns: 4,
  created_at: '2026-10-12T12:00:00Z',
  booths: Array.from({ length: 8 }, (_, i) => ({
    id: 'booth-' + i,
    label: String(i + 1),
    row: Math.floor(i / 4) + 1,
    column: (i % 4) + 1,
    enabled: true,
  })),
};
function clientFor(state: string) {
  const c = new Client('', '');
  c.request = async <T,>(path: string): Promise<T> => {
    if (state === 'loading') return new Promise(() => {});
    if (state === 'error') throw new Error('Room read interrupted');
    return (path === '/rooms' ? (state === 'empty' ? [] : [fixture]) : []) as T;
  };
  return c;
}
export function RoomsGallery() {
  const [state, setState] = useState('populated');
  const [client, setClient] = useState(() => clientFor(state));
  return (
    <section id="rooms-gallery" aria-label="Room gallery" className="ui-stack">
      <Toolbar>
        {['populated', 'loading', 'empty', 'error', 'readonly'].map((s) => (
          <Button
            compact
            key={s}
            onClick={() => {
              setState(s);
              setClient(clientFor(s));
            }}
          >
            {s}
          </Button>
        ))}
      </Toolbar>
      <Rooms key={state} client={client} readOnly={state === 'readonly'} />
    </section>
  );
}
