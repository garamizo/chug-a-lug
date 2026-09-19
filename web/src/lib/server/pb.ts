import PocketBase from 'pocketbase';
import { error } from '@sveltejs/kit';
import { serverEnv } from './env';
import type { UserRecord } from '$lib/types';

let admin: PocketBase | null = null;

/** Superuser client for server-side writes (legs, event_log, google photos). */
export async function adminPb(): Promise<PocketBase> {
  if (admin?.authStore.isValid) return admin;
  const pb = new PocketBase(serverEnv.pbUrl);
  pb.autoCancellation(false);
  await pb.collection('_superusers').authWithPassword(serverEnv.pbAdminEmail, serverEnv.pbAdminPassword);
  admin = pb;
  return pb;
}

const cache = new Map<string, { user: UserRecord; until: number }>();

/** Validates the browser's PocketBase token against PocketBase; cached five minutes per token. */
export async function requireUser(request: Request): Promise<UserRecord> {
  const token = request.headers.get('authorization') ?? '';
  if (!token) throw error(401, 'Log in first.');
  const hit = cache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const res = await fetch(`${serverEnv.pbUrl}/api/collections/users/auth-refresh`, { method: 'POST', headers: { Authorization: token } });
  if (!res.ok) throw error(401, 'Your session expired. Log in again.');
  const user = (await res.json()).record as UserRecord;
  if (cache.size > 200) cache.clear();
  cache.set(token, { user, until: Date.now() + 5 * 60_000 });
  return user;
}

export function requireInternal(request: Request): void {
  const secret = serverEnv.internalSecret;
  if (!secret || request.headers.get('x-internal-secret') !== secret) throw error(401, 'Bad internal secret.');
}
