// The manual OAuth2 code flow (spec §5): popups are unreliable in installed iOS web apps.
export const GOOGLE_KEY = 'chugalug_google';
export type GoogleState = { mode: 'join' | 'login'; name: string; state: string; codeVerifier: string; redirectUrl: string };
export const buildAuthUrl = (authURL: string, redirectUrl: string) => authURL + encodeURIComponent(redirectUrl);
export function readReturn(url: URL, stored: GoogleState | null): { ok: true; code: string } | { ok: false } {
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  return stored && code && state && state === stored.state ? { ok: true, code } : { ok: false };
}

// A retry hint is not OAuth state: it cannot authorize an exchange and contains no code/verifier.
export const GOOGLE_RETRY_KEY = 'chugalug_google_retry';
type GoogleRetry = Pick<GoogleState, 'mode' | 'name'>;
export function saveGoogleRetry(storage: Pick<Storage, 'setItem'>, hint: GoogleRetry, now = Date.now()): void {
  try { storage.setItem(GOOGLE_RETRY_KEY, JSON.stringify({ mode: hint.mode, name: hint.name, savedAt: now })); } catch { /* optional convenience */ }
}
export function loadGoogleRetry(storage: Pick<Storage, 'getItem'>, now = Date.now()): GoogleRetry | null {
  try {
    const hint = JSON.parse(storage.getItem(GOOGLE_RETRY_KEY) ?? 'null');
    if (!hint || !['join', 'login'].includes(hint.mode) || typeof hint.name !== 'string' || hint.name.length > 32 ||
      typeof hint.savedAt !== 'number' || now < hint.savedAt || now - hint.savedAt >= 30 * 60e3) return null;
    return { mode: hint.mode, name: hint.name };
  } catch { return null; }
}
