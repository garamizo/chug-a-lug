// Which service alerts this browser has already shown, and which ones its user closed. Per-device
// on purpose: they are read markers, not shared state, and nothing breaks if they are lost. Every
// access is guarded because a private window, cleared site data or a blocked store all make
// localStorage throw.
const SEEN = 'chugalug.seenAlerts';
const DISMISSED = 'chugalug.dismissedAlerts';

function readIds(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function addIds(key: string, ids: string[]): void {
  try {
    const next = readIds(key);
    for (const id of ids) next.add(id);
    localStorage.setItem(key, JSON.stringify([...next]));
  } catch {
    // An unreadable store just means the dot keeps showing, or a closed bubble comes back.
  }
}

export const readSeen = (): Set<string> => readIds(SEEN);
export const markSeen = (ids: string[]): void => addIds(SEEN, ids);

/** Alerts closed with their X on Live. A new alert from Metra has a new id and shows again. */
export const readDismissed = (): Set<string> => readIds(DISMISSED);
export const dismissAlert = (id: string): void => addIds(DISMISSED, [id]);

export const unseenCount = (alerts: { id: string }[], seen: Set<string>): number =>
  alerts.reduce((n, a) => (seen.has(a.id) ? n : n + 1), 0);
