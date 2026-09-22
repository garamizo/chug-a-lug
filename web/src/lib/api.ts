import { env } from '$env/dynamic/public';
import { pb } from '$lib/pb';

/** Calls our SvelteKit /api/* routes with the PocketBase token. Throws Error(message) on failure. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', pb.authStore.token);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, ...(env.PUBLIC_SIM === '1' ? { cache: 'no-store' as const } : {}), headers, body });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try { message = (await res.json()).message ?? message; } catch { /* not json */ }
    throw new Error(message);
  }
  return (await res.json()) as T;
}
