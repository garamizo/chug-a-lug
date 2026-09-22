import PocketBase, { BaseAuthStore, type AuthRecord } from 'pocketbase';
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

/** Shared-password login: creates the crew identity for this name on first use. */
export async function login(name: string, password: string): Promise<void> {
  const res = await pb.send('/api/crawl/login', { method: 'POST', body: { name, password } });
  pb.authStore.save(res.token, res.record);
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
