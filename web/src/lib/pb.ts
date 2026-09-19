import PocketBase, { BaseAuthStore, type AuthRecord, type RecordModel } from 'pocketbase';
import { writable } from 'svelte/store';
import { env } from '$env/dynamic/public';

export type UserRecord = RecordModel & {
  name: string;
  name_key: string;
  is_admin: boolean;
  share_position: boolean;
  home_station: string;
  left_early: boolean;
};

const COOKIE = 'pb_auth';
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
