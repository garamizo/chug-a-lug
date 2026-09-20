// Which service alerts this browser has already shown. Per-device on purpose: it is a read marker,
// not shared state, and nothing breaks if it is lost. Every access is guarded because a private
// window, cleared site data or a blocked store all make localStorage throw.
const KEY = 'chugalug.seenAlerts';

export function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function markSeen(ids: string[]): void {
  try {
    const next = readSeen();
    for (const id of ids) next.add(id);
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    // An unreadable store just means the dot keeps showing; nothing else depends on it.
  }
}

export const unseenCount = (alerts: { id: string }[], seen: Set<string>): number =>
  alerts.reduce((n, a) => (seen.has(a.id) ? n : n + 1), 0);
