// The live day, owned by the app layout and read by every screen: one poller, one set of
// subscriptions, one answer to "where are we". Event time drives the board; mirror age uses wall time.
import { clientClock } from '$lib/sim/clock.svelte';
import { pb, subscribe } from '$lib/pb';
import { localToUtc, parseHm, todayInTz } from '$lib/time';
import { mirrorPayload, readMirror, saveMirror, scopeMirror } from '$lib/offline';
import { currentStop, type Current } from './current';
import { pickTrip } from './board';
import { fetchAlerts, fetchNext, fetchStatus } from './feed';
import type { Alert, Broadcast, BroadcastAck, ChatMessage, Checkin, DrinkEntry, FeedMode, Itinerary, Leg, Media, NextTrip, Reaction, Stop } from '$lib/types';

export class LiveDay {
  itinerary = $state<Itinerary | null>(null);
  stops = $state<Stop[]>([]);
  legs = $state<Leg[]>([]);
  fromMirror = $state(false);
  mirrorSavedAt = $state<string | null>(null);
  anchor = $state<{ stopId: string; at: string } | null>(null);
  trips = $state<NextTrip[]>([]);
  alerts = $state<Alert[]>([]);
  bulletins = $state<Broadcast[]>([]);
  ackedIds = $state<string[]>([]);
  /** Got it taps still being saved: hidden now, so a reload racing the save cannot bring one back. */
  acking = $state<string[]>([]);
  /** Everything the crew did on this route today: the chat, milestones, leaderboard and Tab read it. */
  feed = $state<{ drinks: DrinkEntry[]; media: Media[]; messages: ChatMessage[]; reactions: Reaction[] }>({ drinks: [], media: [], messages: [], reactions: [] });
  feedError = $state(false);
  // One flag, one owner: the root layout (which has no live day of its own) sets this from the
  // menu, and the `(app)` layout — the only place with a route to post to — reads it to render the
  // compose sheet. No prop drilling through a layout that has nothing else to do with a Bulletin.
  composing = $state(false);
  mode = $state<FeedMode>('schedule_only');
  rtFetchedAt = $state<string | null>(null);
  now = $state(new Date());
  wallNow = $state(new Date());
  get clockKnown() { return !clientClock.enabled || !!clientClock.sample; }

  get startAt(): Date {
    return this.itinerary ? localToUtc(this.itinerary.event_date, parseHm(this.itinerary.start_time)) : new Date();
  }
  /** The board only takes over on the day itself. */
  get isToday(): boolean {
    return this.clockKnown && !!this.itinerary && this.itinerary.event_date === todayInTz(this.now);
  }
  get here(): Current | null {
    if (!this.itinerary || !this.isToday) return null;
    return currentStop(this.stops, this.legs, this.now, { startAt: this.startAt, override: this.anchor });
  }
  get trip(): NextTrip | null {
    return pickTrip(this.trips, this.now);
  }
  /** The newest Bulletin this browser's user has not acknowledged. */
  get pinnedBulletin(): Broadcast | null {
    return this.bulletins.find((b) => !this.isAcked(b.id)) ?? null;
  }
  isAcked(id: string): boolean {
    return this.ackedIds.includes(id) || this.acking.includes(id);
  }
  /** Hides the Bulletin at once and saves the Got it behind it. False if it had to come back. */
  async ack(broadcastId: string, userId: string): Promise<boolean> {
    if (this.acking.includes(broadcastId)) return true;
    this.acking = [...this.acking, broadcastId];
    try {
      await clientClock.ready();
      await pb.collection('broadcast_acks').create({ broadcast: broadcastId, user: userId });
      this.ackedIds = [...this.ackedIds, broadcastId];
    } catch { /* the refresh below tells a lost save from one another tab already made */ }
    await this.loadBulletins();
    this.acking = this.acking.filter((id) => id !== broadcastId);
    return this.ackedIds.includes(broadcastId);
  }
  /** The Tab at the stop the crawl is in. */
  get drinks(): DrinkEntry[] {
    const id = this.here?.stop?.id;
    return id ? this.feed.drinks.filter((d) => d.stop === id) : [];
  }
  /** Freight from the stop the crawl is in, newest first. */
  get media(): Media[] {
    const id = this.here?.stop?.id;
    return id ? this.feed.media.filter((m) => m.stop === id).sort((a, b) => (b.created ?? '').localeCompare(a.created ?? '')) : [];
  }

  private routeRead = 0;
  private routeRun: string | undefined;
  async loadRoute() {
    const request = ++this.routeRead, runId = clientClock.runId;
    if (clientClock.enabled && runId && this.routeRun !== runId) {
      this.itinerary = null; this.stops = []; this.legs = []; this.anchor = null;
      this.bulletins = []; this.ackedIds = []; this.acking = []; this.feed = { drinks: [], media: [], messages: [], reactions: [] };
      this.fromMirror = false; this.mirrorSavedAt = null; this.routeRun = runId;
      await scopeMirror(runId);
    }
    try {
      // Workbox also respects no-store: a cached HTTP success must not re-date an old plan.
      const list = await pb.collection('itineraries').getFullList<Itinerary>({ filter: pb.filter('status = "locked"'), sort: '-locked_at', cache: 'no-store' });
      if (request !== this.routeRead || runId !== clientClock.runId) return;
      const itinerary = list[0] ?? null;
      if (!itinerary) {
        this.itinerary = null; this.stops = []; this.legs = []; this.anchor = null;
        this.fromMirror = false; this.mirrorSavedAt = null;
        return;
      }
      const filter = pb.filter('itinerary = {:id}', { id: itinerary.id });
      const [stops, legs] = await Promise.all([
        pb.collection('stops').getFullList<Stop>({ filter, sort: 'order,created', expand: 'place', cache: 'no-store' }),
        pb.collection('legs').getFullList<Leg>({ filter, cache: 'no-store' })
      ]);
      if (request !== this.routeRead || runId !== clientClock.runId) return;
      // Keep the raw responses for IndexedDB: reading them back through $state gives proxies,
      // which structured cloning rejects. Publish only after all three reads succeed.
      if (!clientClock.enabled || clientClock.runId) void saveMirror(mirrorPayload(itinerary, stops, legs, new Date(), clientClock.runId));
      this.itinerary = itinerary; this.stops = stops; this.legs = legs;
      this.fromMirror = false; this.mirrorSavedAt = null;
      await this.loadAnchor();
    } catch {
      // No signal: the last known plan is better than an empty screen, as long as it says so.
      const mirror = await readMirror();
      if (request !== this.routeRead || runId !== clientClock.runId) return;
      if (!mirror || (clientClock.enabled && clientClock.runId && mirror.runId !== clientClock.runId)) throw new Error('offline and no mirror');
      this.itinerary = mirror.itinerary;
      this.stops = mirror.stops;
      this.legs = mirror.legs;
      this.mirrorSavedAt = mirror.savedAt;
      this.fromMirror = true;
    }
  }

  private anchorRead = 0;
  async loadAnchor(itineraryId = this.itinerary?.id) {
    const request = ++this.anchorRead;
    if (!itineraryId) { this.anchor = null; return; }
    try {
      const rows = await pb.collection('checkins').getList<Checkin>(1, 20, {
        filter: pb.filter('kind = "at_stop" && stop.itinerary = {:id}', { id: itineraryId }),
        sort: '-at,-action_order', expand: 'user'
      });
      if (request !== this.anchorRead) return;
      const hit = rows.items.find((c) => c.expand?.user?.is_admin && c.stop);
      this.anchor = hit ? { stopId: hit.stop, at: hit.at } : null;
    } catch { if (request === this.anchorRead) this.anchor = null; }
  }

  private bulletinRead = 0;
  async loadBulletins() {
    const request = ++this.bulletinRead;
    if (!this.itinerary) { this.bulletins = []; return; }
    try {
      const filter = pb.filter('itinerary = {:id}', { id: this.itinerary.id });
      const [rows, acks] = await Promise.all([
        pb.collection('broadcasts').getFullList<Broadcast>({ filter, sort: '-created', expand: 'created_by' }),
        pb.collection('broadcast_acks').getFullList<BroadcastAck>({ filter: pb.filter('user = {:u}', { u: pb.authStore.record?.id ?? '' }) })
      ]);
      if (request !== this.bulletinRead) return;
      this.bulletins = rows;
      this.ackedIds = acks.map((a) => a.broadcast);
    } catch { /* offline: keep whatever we had */ }
  }

  private feedRead = 0;
  async loadFeed() {
    const request = ++this.feedRead;
    const id = this.itinerary?.id;
    if (!id) { this.feed = { drinks: [], media: [], messages: [], reactions: [] }; return; }
    const byStop = pb.filter('stop.itinerary = {:id}', { id }), byRoute = pb.filter('itinerary = {:id}', { id });
    try {
      const [drinks, media, messages, reactions] = await Promise.all([
        pb.collection('drink_entries').getFullList<DrinkEntry>({ filter: byStop, expand: 'user,stop', sort: 'at,action_order,created,id', cache: 'no-store' }),
        pb.collection('media').getFullList<Media>({ filter: byStop, expand: 'user', sort: 'at,created,id', cache: 'no-store' }),
        pb.collection('chat_messages').getFullList<ChatMessage>({ filter: byRoute, expand: 'user', sort: 'at,created,id', cache: 'no-store' }),
        pb.collection('reactions').getFullList<Reaction>({ filter: byRoute, cache: 'no-store' })
      ]);
      if (request !== this.feedRead || id !== this.itinerary?.id) return;
      this.feed = { drinks, media, messages, reactions };
      this.feedError = false;
    } catch { if (request === this.feedRead) this.feedError = true; }
  }

  /** Put a confirmed write into the feed now and discard any read that started before it. */
  upsertDrink(row: DrinkEntry) {
    this.feedRead++;
    this.feed = { ...this.feed, drinks: [...this.feed.drinks.filter((d) => d.id !== row.id), row] };
  }

  /** Take a confirmed delete out of the feed now and discard any read that started before it. */
  dropDrink(id: string) {
    this.feedRead++;
    this.feed = { ...this.feed, drinks: this.feed.drinks.filter((d) => d.id !== id) };
  }

  private trainRead = 0;
  private alertRead = 0;
  async loadTrains() {
    const request = ++this.trainRead, revision = clientClock.revision;
    const here = this.here;
    // The train goes to the next *different* station: with several bars at one station the literal
    // next stop is another bar here, and a trip from a station to itself does not exist.
    if (!here?.stop || !here.onwardStop || !this.itinerary) { this.trips = []; return; }
    try {
      const res = await fetchNext(here.stop.station_id, here.onwardStop.station_id, this.itinerary.event_date, this.now);
      if (request !== this.trainRead || revision !== clientClock.revision) return;
      this.trips = res.trips;
      this.mode = res.mode;
      this.rtFetchedAt = res.fetchedAt;
    } catch { if (request === this.trainRead && revision === clientClock.revision) this.trips = []; }
  }

  async loadAlerts() {
    const request = ++this.alertRead, revision = clientClock.revision;
    try { const res = await fetchAlerts(); if (request === this.alertRead && revision === clientClock.revision) this.alerts = res.alerts; } catch { if (request === this.alertRead && revision === clientClock.revision) this.alerts = []; }
  }

  /** Starts the pollers and subscriptions. Returns the teardown; safe to call once per layout. */
  start(): () => void {
    let stopped = false;
    this.now = clientClock.eventNow() ?? this.now;
    const revisionRefresh = clientClock.onRevision(() => {
      this.now = clientClock.eventNow() ?? this.now;
      this.anchorRead++; this.feedRead++; this.bulletinRead++;
      this.trainRead++; this.alertRead++; this.trips = []; this.alerts = [];
      void this.loadRoute().then(() => { if (stopped) return; void this.loadBulletins(); void this.loadTrains(); void this.loadAlerts(); void this.loadFeed(); }).catch(() => {});
    });
    const refreshRoute = () => void this.loadRoute()
      .then(() => { if (!stopped) return this.loadBulletins(); })
      .catch(() => {});
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    // One Save produces many stop/leg events. Reload after the burst settles.
    const queueRefresh = () => {
      if (stopped) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { refreshTimer = undefined; refreshRoute(); }, 750);
    };
    void this.loadRoute().then(() => { if (stopped) return; void this.loadBulletins(); void this.loadTrains(); void this.loadFeed(); }).catch(() => {});
    void this.loadAlerts();
    void fetchStatus().then((s) => { if (stopped) return; this.rtFetchedAt = s.feeds?.tripupdates?.fetchedAt ?? null; this.mode = s.mode; }).catch(() => {});
    const tick = setInterval(() => { this.wallNow = new Date(); this.now = clientClock.eventNow() ?? this.now; }, clientClock.enabled ? 250 : 15_000);
    const replayPoll = clientClock.enabled ? setInterval(() => { if (this.clockKnown) { void this.loadTrains(); void this.loadAlerts(); } }, 1000) : undefined;
    const poll = setInterval(() => { refreshRoute(); void this.loadTrains(); void this.loadAlerts(); void this.loadFeed(); }, 30_000);
    // Unit tests run under Node, where there is no window.
    const online = () => void this.loadFeed();
    if (typeof window !== 'undefined') window.addEventListener('online', online);
    const unsubs = [
      subscribe('itineraries', '', queueRefresh),
      subscribe('stops', '', queueRefresh),
      subscribe('legs', '', queueRefresh),
      subscribe('checkins', '', () => void this.loadAnchor()),
      subscribe('broadcasts', '', () => void this.loadBulletins()),
      subscribe('broadcast_acks', '', () => void this.loadBulletins()),
      ...['drink_entries', 'media', 'chat_messages', 'reactions', 'users'].map((name) => subscribe(name, '', () => void this.loadFeed()))
    ];
    return () => {
      stopped = true; this.routeRead++; this.anchorRead++; this.feedRead++; this.bulletinRead++; revisionRefresh(); this.trainRead++; this.alertRead++; clearInterval(replayPoll); clearTimeout(refreshTimer);
      clearInterval(tick); clearInterval(poll); unsubs.forEach((u) => u());
      if (typeof window !== 'undefined') window.removeEventListener('online', online);
    };
  }
}

export const liveDay = new LiveDay();
