// A sign-up outlives a reload, not the tab: the join link's token and, once the code is mailed, the
// sign-up's id and secret wait in sessionStorage for the 60 minutes the server keeps the sign-up.
export type StoredSignup = { token: string; signupId?: string; secret?: string; name?: string; email?: string; codeSent?: boolean; savedAt: number };
export const SIGNUP_KEY = 'chugalug_signup';
const TTL = 60 * 60e3;

/** The token is the first 32 letters/digits after `#`: trailing punctuation from a chat app is ignored. */
export function tokenFromHash(hash: string): string | null {
  return /^#([A-Za-z0-9]{32})/.exec(hash)?.[1] ?? null;
}
export function saveSignup(store: Pick<Storage, 'setItem'>, s: StoredSignup): void {
  try { store.setItem(SIGNUP_KEY, JSON.stringify(s)); } catch { /* private mode: the page still works this visit */ }
}
export function loadSignup(store: Pick<Storage, 'getItem'>, now = Date.now()): StoredSignup | null {
  try {
    const s = JSON.parse(store.getItem(SIGNUP_KEY) ?? 'null') as StoredSignup | null;
    return s && typeof s.token === 'string' && typeof s.savedAt === 'number' && now - s.savedAt < TTL ? s : null;
  } catch { return null; }
}
export function clearSignup(store: Pick<Storage, 'removeItem'>): void {
  try { store.removeItem(SIGNUP_KEY); } catch { /* nothing to clear */ }
}
