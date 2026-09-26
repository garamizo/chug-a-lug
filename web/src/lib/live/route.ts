// Which route the app is about: the Conductor's selection while it is still locked, otherwise the
// most recently locked one. Everything that means "the route" goes through here.
import { pb } from '$lib/pb';
import type { CrawlSettings, Itinerary } from '$lib/types';

// The PocketBase SDK reserves status 0 for a request that never reached the server (offline, an
// abort); anything else failing here — no `crawlsettings` row yet, a stale schema, a real 404 —
// just means there is no valid selection, so fall through to the newest locked route instead.
const isNetworkFailure = (e: unknown) => (e as { status?: number })?.status === 0;

export async function resolveCurrentRoute(): Promise<Itinerary | null> {
  // Both at once: over the tunnel a missing selection would otherwise cost a second round trip on
  // every screen's first load. The list's own failure only matters if the selection is unusable.
  const fallback = pb.collection('itineraries').getFullList<Itinerary>({ filter: 'status = "locked"', sort: '-locked_at', cache: 'no-store' });
  fallback.catch(() => {});
  try {
    const settings = await pb.collection('crawl_settings').getOne<CrawlSettings>('crawlsettings', { expand: 'current_itinerary', cache: 'no-store' });
    const chosen = settings.expand?.current_itinerary;
    if (chosen?.status === 'locked') return chosen;
  } catch (e) { if (isNetworkFailure(e)) throw e; }
  return (await fallback)[0] ?? null;
}

export async function setCurrentRoute(id: string): Promise<void> {
  await pb.collection('crawl_settings').update('crawlsettings', { current_itinerary: id });
}
