// Polls Metra's three GTFS-realtime feeds and keeps the newest decoded message of each in memory.
// A fetch failure keeps the previous feed; it never clears one. The token is read here and nowhere
// else, and never leaves the server.
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
export type FeedMessage = InstanceType<typeof FeedMessage>;

export type FeedName = 'positions' | 'tripupdates' | 'alerts';
export const FEED_NAMES: FeedName[] = ['positions', 'tripupdates', 'alerts'];

export type Feed = { message: FeedMessage; fetchedAt: string };
export type Feeds = Record<FeedName, Feed | null>;
export type FeedStatus = { fetchedAt: string | null; ageSec: number | null; enabled: boolean };
/** The newest fetch across all feeds, plus each feed on its own. */
export type RealtimeStatus = FeedStatus & { feeds: Record<FeedName, FeedStatus> };

export type RealtimeConfig = {
  base: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** Metra publishes every 30 s and asks that nobody poll faster. */
  pollMs?: number;
  now?: () => Date;
};

export function createRealtimeLoader(cfg: RealtimeConfig) {
  let fetchImpl = cfg.fetchImpl ?? fetch;
  const now = cfg.now ?? (() => new Date());
  const pollMs = cfg.pollMs ?? 30_000;
  const feeds: Feeds = { positions: null, tripupdates: null, alerts: null };
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;

  async function fetchOne(name: FeedName, at: Date): Promise<void> {
    const res = await fetchImpl(`${cfg.base}/${name}`, { headers: { Authorization: `Bearer ${cfg.token}` } });
    if (!res.ok) throw new Error(`${name} HTTP ${res.status}`);
    const message = FeedMessage.decode(new Uint8Array(await res.arrayBuffer()));
    feeds[name] = { message, fetchedAt: at.toISOString() };
  }

  async function refresh(opts?: { at?: Date }): Promise<void> {
    if (!cfg.token) return;
    if (inFlight) return inFlight;
    const at = opts?.at ?? now();
    inFlight = (async () => {
      const results = await Promise.allSettled(FEED_NAMES.map((n) => fetchOne(n, at)));
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') return;
        // Never log the reason object wholesale: it can carry the request headers.
        console.warn(`[metra-rt] ${FEED_NAMES[i]} fetch failed:`, (r.reason as Error)?.message ?? 'unknown');
      });
      // Nothing to record here: each feed's own `fetchedAt` was stamped by its successful fetchOne,
      // and a failed feed keeps the older one. Freshness is per feed on purpose.
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  function start(): void {
    if (timer || !cfg.token) return;
    void refresh();
    timer = setInterval(() => void refresh(), pollMs);
    // Do not hold the Node event loop open just for polling.
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  const ageOf = (at: string | null): number | null =>
    at === null ? null : Math.max(0, Math.round((now().getTime() - new Date(at).getTime()) / 1000));

  function statusOf(name: FeedName): FeedStatus {
    if (!cfg.token) return { fetchedAt: null, ageSec: null, enabled: false };
    const fetchedAt = feeds[name]?.fetchedAt ?? null;
    return { fetchedAt, ageSec: ageOf(fetchedAt), enabled: true };
  }

  return {
    refresh,
    start,
    feeds: () => feeds,
    statusOf,
    status(): RealtimeStatus {
      const perFeed = Object.fromEntries(FEED_NAMES.map((n) => [n, statusOf(n)])) as Record<FeedName, FeedStatus>;
      if (!cfg.token) return { fetchedAt: null, ageSec: null, enabled: false, feeds: perFeed };
      // The headline figure is the newest fetch of any feed: useful to an operator, useless for
      // deciding whether one feed's contents can be trusted. Callers that care use statusOf().
      const newest = FEED_NAMES
        .map((n) => perFeed[n].fetchedAt)
        .filter((at): at is string => at !== null)
        .sort()
        .at(-1) ?? null;
      return { fetchedAt: newest, ageSec: ageOf(newest), enabled: true, feeds: perFeed };
    },
    /** Tests swap the fetch to simulate an outage after a good poll. */
    setFetch(next: typeof fetch) { fetchImpl = next; },
    stop() { if (timer) { clearInterval(timer); timer = null; } }
  };
}
