// The manual OAuth2 code flow (spec §5): popups are unreliable in installed iOS web apps.
export const GOOGLE_KEY = 'chugalug_google';
export type GoogleState = { mode: 'join' | 'login'; name: string; state: string; codeVerifier: string; redirectUrl: string };
export const buildAuthUrl = (authURL: string, redirectUrl: string) => authURL + encodeURIComponent(redirectUrl);
export function readReturn(url: URL, stored: GoogleState | null): { ok: true; code: string } | { ok: false } {
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  return stored && code && state && state === stored.state ? { ok: true, code } : { ok: false };
}
