// Only the locked route belongs on disk: enough to answer "where are we going next". Storage
// is optional, including when a private window exposes IndexedDB but refuses to open it.
import type { Itinerary, Leg, Stop } from '$lib/types';
import { copy } from '$lib/labels';
import { fmtDateTime } from '$lib/time';

const DB = 'chugalug';
const STORE = 'mirror';
const KEY = 'route';

export type Mirror = { savedAt: string; itinerary: Itinerary; stops: Stop[]; legs: Leg[] };

export function mirrorPayload(itinerary: Itinerary, stops: Stop[], legs: Leg[], now: Date): Mirror {
  return { savedAt: now.toISOString(), itinerary, stops, legs };
}

export function mirrorAgeMin(mirror: Pick<Mirror, 'savedAt'>, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(mirror.savedAt).getTime()) / 60_000));
}

export function mirrorSavedWhen(savedAt: string, now: Date): string {
  const age = mirrorAgeMin({ savedAt }, now);
  // Minutes help during a short tunnel outage. At an hour, show the saved date and time so
  // an older plan is easy to place and a days-old copy cannot look like it was saved today.
  return age < 60 ? `${age} ${copy.minutesAgo}` : fmtDateTime(savedAt);
}

function close(db: IDBDatabase): void {
  try { db.close(); } catch { /* Storage may have disappeared while the request was running. */ }
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      // A blocked open can succeed later; do not leave that unused connection holding a lock.
      if (settled) { if (db) close(db); return; }
      settled = true;
      resolve(db);
    };
    try {
      if (typeof indexedDB === 'undefined') return finish(null);
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        try { request.result.createObjectStore(STORE); }
        catch {
          try { request.transaction?.abort(); } catch { /* Already aborted. */ }
          finish(null);
        }
      };
      request.onsuccess = () => {
        try {
          const db = request.result;
          db.onversionchange = () => close(db);
          finish(db);
        } catch { finish(null); }
      };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch { finish(null); }
  });
}

export async function saveMirror(mirror: Mirror): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
        tx.objectStore(STORE).put(mirror, KEY);
      } catch { resolve(); }
    });
  } finally { close(db); }
}

export async function readMirror(): Promise<Mirror | null> {
  const db = await open();
  if (!db) return null;
  try {
    return await new Promise<Mirror | null>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const request = tx.objectStore(STORE).get(KEY);
        tx.oncomplete = () => {
          try { resolve((request.result as Mirror) ?? null); }
          catch { resolve(null); }
        };
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch { resolve(null); }
    });
  } finally { close(db); }
}
