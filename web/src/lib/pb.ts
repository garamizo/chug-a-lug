import PocketBase, { type RecordModel } from 'pocketbase';
import { writable } from 'svelte/store';
import { env } from '$env/dynamic/public';

export type UserRecord = RecordModel & {
  phone: string;
  name: string;
  is_admin: boolean;
  share_position: boolean;
  home_station: string;
  left_early: boolean;
};

export const pb = new PocketBase(env.PUBLIC_PB_URL || 'http://127.0.0.1:8090');
pb.autoCancellation(false);

export const auth = writable<{ user: UserRecord | null }>({
  user: pb.authStore.isValid ? (pb.authStore.record as UserRecord) : null
});

pb.authStore.onChange(() => {
  auth.set({ user: pb.authStore.isValid ? (pb.authStore.record as UserRecord) : null });
});

export async function startOtp(phone: string): Promise<void> {
  await pb.send('/api/crawl/otp/start', { method: 'POST', body: { phone } });
}

export async function checkOtp(phone: string, code: string, pin: string): Promise<void> {
  const res = await pb.send('/api/crawl/otp/check', { method: 'POST', body: { phone, code, pin } });
  pb.authStore.save(res.token, res.record);
}

export async function loginWithPin(phone: string, pin: string): Promise<void> {
  await pb.collection('users').authWithPassword(phone, pin);
}

export function logout(): void {
  pb.authStore.clear();
}
