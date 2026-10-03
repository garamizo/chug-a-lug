import PocketBase, { BaseAuthStore, getTokenPayload, type AuthRecord } from 'pocketbase';
import { writable } from 'svelte/store';
import { env } from '$env/dynamic/public';
import type { UserRecord } from './types';

export type { UserRecord } from './types';

const COOKIE = env.PUBLIC_SIM === '1' ? 'pb_auth_rehearsal' : 'pb_auth';
const ONE_YEAR = 60 * 60 * 24 * 365;

/** Keeps the PocketBase session in a cookie on the app's origin instead of localStorage. */
class CookieAuthStore extends BaseAuthStore {
  constructor() {
    super();
    if (typeof document !== 'undefined') this.loadFromCookie(document.cookie, COOKIE);
  }
  save(token: string, record?: AuthRecord | null): void {
    super.save(token, record);
    this.persist();
  }
  clear(): void {
    super.clear();
    this.persist();
  }
  private persist(): void {
    if (typeof document === 'undefined') return;
    if (!this.isValid) {
      document.cookie = `${COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
      return;
    }
    document.cookie = this.exportToCookie(
      { httpOnly: false, secure: location.protocol === 'https:', sameSite: 'Lax', path: '/', maxAge: ONE_YEAR },
      COOKIE
    );
  }
}

export const pb = new PocketBase(env.PUBLIC_PB_URL || 'http://127.0.0.1:8090', new CookieAuthStore());
pb.autoCancellation(false);
if (env.PUBLIC_SIM === '1') pb.beforeSend = (url, options) => ({ url, options: { ...options, cache: 'no-store' } });

export const auth = writable<{ user: UserRecord | null }>({
  user: pb.authStore.isValid ? (pb.authStore.record as UserRecord) : null
});

pb.authStore.onChange(() => {
  auth.set({ user: pb.authStore.isValid ? (pb.authStore.record as UserRecord) : null });
});

/** Rehearsal only (PUBLIC_SIM=1): shared-password login that creates the identity for this name. */
export async function rehearsalLogin(name: string, password: string): Promise<void> {
  const res = await pb.send('/api/crawl/login', { method: 'POST', body: { name, password } });
  pb.authStore.save(res.token, res.record);
}

/** Email code sign-in (PocketBase OTP). The SDK saves the session into the cookie store. */
export async function requestCode(email: string): Promise<string> {
  return (await pb.collection('users').requestOTP(email.trim().toLowerCase())).otpId;
}
export async function signInWithCode(otpId: string, code: string): Promise<void> {
  await pb.collection('users').authWithOTP(otpId, code.trim());
}
export const joinCrew = (name: string, email: string, turnstile: string) =>
  pb.send<{ request_id: string; secret: string }>('/api/crawl/join', { method: 'POST', body: { name, email, turnstile } });
export const verifyJoin = (request_id: string, secret: string, code: string) =>
  pb.send('/api/crawl/join/verify', { method: 'POST', body: { request_id, secret, code } });
export const joinStatus = (request_id: string, secret: string) =>
  pb.send<{ status: string }>('/api/crawl/join/status', { method: 'POST', body: { request_id, secret } });
export const resendJoin = (request_id: string, secret: string) =>
  pb.send('/api/crawl/join/resend', { method: 'POST', body: { request_id, secret } });
/**
 * Spec §5, on every app open: ask who we are (GET /api/crawl/me, which mints nothing), and renew
 * the token only in its last week. Only a 401/403 ends the session; no signal keeps it (offline
 * event day). Impersonated test sessions are long-lived and never reach the renewal branch.
 */
export async function refreshSession(): Promise<'ok' | 'signed_out' | 'offline'> {
  if (!pb.authStore.isValid) return 'signed_out';
  try {
    await pb.send('/api/crawl/me', { method: 'GET' });
    const exp = Number(getTokenPayload(pb.authStore.token).exp ?? 0) * 1000;
    if (exp - Date.now() < 7 * 86400e3) await pb.collection('users').authRefresh();
    return 'ok';
  } catch (e) {
    const status = (e as { status?: number }).status ?? 0;
    return status === 401 || status === 403 ? 'signed_out' : 'offline';
  }
}

export function logout(): void {
  pb.authStore.clear();
}

/** Realtime subscription that refires `onChange` on any create/update/delete matching the filter. */
export function subscribe(collection: string, filter: string, onChange: () => void): () => void {
  let unsub: (() => void) | null = null;
  let active = true;
  pb.collection(collection)
    .subscribe('*', () => onChange(), filter ? { filter } : {})
    .then((u) => { if (active) unsub = u; else u(); })
    .catch(() => { /* offline: the page still works from its last fetch */ });
  return () => { active = false; unsub?.(); };
}
