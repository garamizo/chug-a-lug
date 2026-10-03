// A boarding request outlives the tab: reopening /join resumes it (spec §5), for up to 72 h.
import { env } from '$env/dynamic/public';

export type StoredBoarding = { requestId: string; secret: string; name: string; email: string; savedAt: number };
export const BOARDING_KEY = env.PUBLIC_SIM === '1' ? 'chugalug_boarding_rehearsal' : 'chugalug_boarding';
const TTL = 72 * 3600e3;

export function loadBoarding(store: Pick<Storage, 'getItem'>, now: number): StoredBoarding | null {
  try {
    const b = JSON.parse(store.getItem(BOARDING_KEY) ?? 'null') as StoredBoarding | null;
    return b && typeof b.requestId === 'string' && now - b.savedAt < TTL ? b : null;
  } catch { return null; }
}
export function saveBoarding(store: Pick<Storage, 'setItem'>, b: StoredBoarding): void {
  try { store.setItem(BOARDING_KEY, JSON.stringify(b)); } catch { /* private mode: the page still works this session */ }
}
export function clearBoarding(store: Pick<Storage, 'removeItem'>): void {
  try { store.removeItem(BOARDING_KEY); } catch { /* nothing to clear */ }
}
export function stepFor(status: string): 'code' | 'waiting' | 'aboard' | 'turned_away' | 'expired' {
  return status === 'unverified' ? 'code' : status === 'waiting' || status === 'aboard' || status === 'turned_away' ? status : 'expired';
}
