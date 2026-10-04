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
/** Email + password sign-in (password spec §2.1). Lowercased like requestCode: addresses are stored lowercased. */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  await pb.collection('users').authWithPassword(email.trim().toLowerCase(), password);
}
/** Always resolves the same way for any address (PocketBase answers 204), so nothing is revealed. */
export async function requestPasswordReset(email: string): Promise<void> {
  await pb.collection('users').requestPasswordReset(email.trim().toLowerCase());
}
export async function confirmPasswordReset(token: string, password: string): Promise<void> {
  await pb.collection('users').confirmPasswordReset(token, password, password);
}
export const joinCrew = (name: string, email: string, password: string, turnstile: string) =>
  pb.send<{ request_id: string; secret: string }>('/api/crawl/join', { method: 'POST', body: { name, email, password, turnstile } });
export const verifyJoin = (request_id: string, secret: string, code: string) =>
  pb.send('/api/crawl/join/verify', { method: 'POST', body: { request_id, secret, code } });
export const joinStatus = (request_id: string, secret: string) =>
  pb.send<{ status: string }>('/api/crawl/join/status', { method: 'POST', body: { request_id, secret } });
export const resendJoin = (request_id: string, secret: string) =>
  pb.send('/api/crawl/join/resend', { method: 'POST', body: { request_id, secret } });
const DAY_MS = 86400e3;
/** users.authToken.duration, set by the crew-access migration. */
const TOKEN_SECONDS = 90 * 86400;

/** PocketBase itself said no: a JSON error with a message. A challenge page from the edge (Cloudflare
 *  Bot Fight Mode answers 403 with HTML) or a dead network is no reason to end a session. */
function refusedByPocketBase(e: unknown): boolean {
  const err = e as { status?: number; response?: { message?: unknown } };
  return (err?.status === 401 || err?.status === 403) && typeof err.response?.message === 'string' && err.response.message !== '';
}

/** When the token was minted: `iat` if it carries one, else its expiry minus the lifetime. */
function issuedAt(token: string): number {
  const p = getTokenPayload(token);
  return typeof p.iat === 'number' ? p.iat * 1000 : (Number(p.exp ?? 0) - TOKEN_SECONDS) * 1000;
}

/**
 * Spec §5, on every app open: ask who we are (GET /api/crawl/me, which mints nothing), apply the
 * record it returns (a promotion or a rename shows without signing in again), and renew a token
 * issued more than a day ago, so anyone who opens the app now and then stays aboard for the event.
 *
 * Only PocketBase's own 401/403 from /me ends the session; no signal keeps it (offline event day),
 * and a failed renewal never does (impersonated test sessions cannot be refreshed). Every answer is
 * applied only while the store still holds the token it was asked about: a logout or a switch of
 * account in the meantime is never undone, and its outcome is then 'ok' (nothing to do).
 */
export async function refreshSession(): Promise<'ok' | 'signed_out' | 'offline'> {
  if (!pb.authStore.isValid) return 'signed_out';
  const token = pb.authStore.token;
  const current = () => pb.authStore.token === token;
  let me: { record?: AuthRecord } | undefined;
  try {
    me = await pb.send('/api/crawl/me', { method: 'GET', headers: { Authorization: token } });
  } catch (e) {
    if (!current()) return 'ok';
    return refusedByPocketBase(e) ? 'signed_out' : 'offline';
  }
  if (!current()) return 'ok';
  if (me?.record) pb.authStore.save(token, me.record);
  if (getTokenPayload(token).refreshable !== false && Date.now() - issuedAt(token) > DAY_MS) {
    try {
      // A raw call, not authRefresh(): the SDK would save its answer into the shared store whatever
      // happened to the session meanwhile.
      const fresh = await pb.send<{ token?: string; record?: AuthRecord }>('/api/collections/users/auth-refresh',
        { method: 'POST', headers: { Authorization: token } });
      if (current() && fresh?.token) pb.authStore.save(fresh.token, fresh.record ?? pb.authStore.record);
    } catch { /* keep the current token; the next open tries again */ }
  }
  return 'ok';
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
