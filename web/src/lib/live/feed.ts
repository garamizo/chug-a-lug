// Reads of the Metra proxy from the browser. The proxy needs the PocketBase token, the same way
// $lib/server/places callers do, so every request carries it.
import { clientClock } from '$lib/sim/clock.svelte';
import { pb } from '$lib/pb';
import type { Alert, FeedMode, NextTrip } from '$lib/types';

const authed = async (path: string) => {
  const revision = clientClock.revision;
  const res = await fetch(path, { cache: clientClock.enabled ? 'no-store' : 'default', headers: { Authorization: pb.authStore.token } });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  const value = await res.json();
  if (clientClock.enabled && (revision !== clientClock.revision || value.revision !== clientClock.revision)) throw new Error('obsolete_feed');
  return value;
};

export const fetchAlerts = (): Promise<{ mode: FeedMode; fetchedAt: string | null; alerts: Alert[] }> =>
  authed('/api/metra/alerts');

export const fetchNext = (from: string, to: string, date: string, after: Date): Promise<{ mode: FeedMode; fetchedAt: string | null; trips: NextTrip[] }> =>
  authed(`/api/metra/next?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${date}&after=${after.toISOString()}&limit=3`);

export const fetchStatus = (): Promise<{
  rtFetchedAt: string | null; mode: FeedMode;
  feeds: Record<'positions' | 'tripupdates' | 'alerts', { fetchedAt: string | null; ageSec: number | null; mode: FeedMode }>;
}> => authed('/api/metra/status');
