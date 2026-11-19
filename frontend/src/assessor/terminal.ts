import type { components } from '../api-schema';
import { ApiError, Client } from '../researcher/client';
import { prepareSession } from './prepare';
import { readSessions, synchronise } from './storage';
import { syncOperations } from './operations';

export interface LocalTerminal {
  id: string;
  token: string;
  revision: number;
  sessionId?: string;
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sensibilia-terminal', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readTerminal(): Promise<LocalTerminal | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('settings').objectStore('settings').get('terminal');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
async function saveTerminal(terminal: LocalTerminal) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite', { durability: 'strict' });
      tx.objectStore('settings').put(terminal, 'terminal');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function prepareTerminal(id: string, token: string) {
  return navigator.locks.request('sensibilia-terminal-handover', async () => {
    const task = await new Client('', token).request<components['schemas']['TerminalTask']>(
      '/terminals/' + id + '/assignment',
      {},
      'session',
    );
    if (!task.session_id)
      throw new Error('Staff must assign an assessment before preparing this tablet.');
    // The server only reassigns a tablet once its previous assessment is no longer running
    // (finished, or ended by staff). Push whatever the tablet still holds for it, then move on.
    // A refusal means the server will not take those events (for example, recorded after staff
    // ended the assessment); they stay in this tablet's storage. Only an unreachable server
    // blocks the handover, so the late answers the server still accepts are not left behind.
    const records = await readSessions();
    for (const r of records) {
      if (r.id === task.session_id) continue;
      if (r.finished && !r.outbox.length && !r.serving?.pending.length) continue;
      try {
        if (r.outbox.length) await synchronise(r.id, () => {});
        if (r.serving?.pending.length) await syncOperations(r.id, () => {});
      } catch (e) {
        if (e instanceof ApiError && e.status === 0)
          throw new Error(
            'Cannot reach the laboratory server to send the previous assessment. Retry when connected.',
          );
      }
    }
    const prepared = await prepareSession(task.session_id, token);
    const confirmed = await new Client('', token).request<components['schemas']['TerminalTask']>(
      '/terminals/' + id + '/assignment',
      {},
      'session',
    );
    if (confirmed.revision !== task.revision || confirmed.session_id !== task.session_id)
      throw new Error(
        'Assignment changed during preparation. Retain the cached record and ask staff to review.',
      );
    await saveTerminal({ id, token, revision: task.revision, sessionId: task.session_id });
    return prepared;
  });
}

/** Exchange a staff-issued one-time code for this tablet's terminal credential. */
export async function redeemPairing(code: string) {
  let response: Response;
  try {
    response = await fetch('/terminal-pairings/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  } catch {
    throw new Error('Cannot reach the laboratory server. Check the network and retry.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.detail === 'string' ? body.detail : 'Pairing failed. Ask staff for a new code.',
    );
  }
  const paired = (await response.json()) as components['schemas']['PairingRedeemed'];
  await saveTerminal({ id: paired.terminal_id, token: paired.terminal_token, revision: -1 });
  const durable = (await navigator.storage?.persist?.().catch(() => false)) ?? false;
  return { name: paired.name, durable };
}
