// The live day, owned by the app layout and read by every screen: one poller, one set of
// subscriptions, one answer to "where are we". Event time drives the board; mirror age uses wall time.
import { clientClock } from '$lib/sim/clock.svelte';
import { untrack } from 'svelte';
import { pb, subscribe } from '$lib/pb';
import { dayBounds, localToUtc, parseHm, todayInTz } from '$lib/time';
import { mirrorPayload, readMirror, saveMirror, scopeMirror } from '$lib/offline';
import { currentStop, type Current } from './current';
import { pickTrip } from './board';
import { fetchAlerts, fetchDay, fetchNext, fetchStatus } from './feed';
import { isEventDay as onEventDate, planNow } from './planClock';
import { resolveCurrentRoute } from './route';
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
  /** The client clock (`clientClock.eventNow()`): real time, or the harness's simulated time. */
  realNow = $state(new Date());
  /** Plan time: `realNow` on the event day, today's time of day laid onto the route's date otherwise. */
  now = $state(new Date());
  wallNow = $state(new Date());
  /** Server clock minus this phone's clock, from the last `/api/day`. Null until the server answers. */
  serverOffset = $state<number | null>(null);
  get clockKnown() { return !clientClock.enabled || !!clientClock.sample; }
  /** The server's Chicago day, counted on this phone's clock so midnight is caught offline too. */
  get today(): string {
    return todayInTz(this.serverOffset === null ? this.realNow : new Date(this.realNow.getTime() + this.serverOffset));
  }

  get startAt(): Date {
    return this.itinerary ? localToUtc(this.itinerary.event_date, parseHm(this.itinerary.start_time)) : new Date();
  }
  get hasRoute(): boolean { return this.clockKnown && !!this.itinerary; }
  get isEventDay(): boolean { return this.hasRoute && onEventDate(this.itinerary!.event_date, this.realNow); }
  get practice(): boolean { return this.hasRoute && !this.isEventDay; }
  // removed in Task 6
  get isToday(): boolean { return this.isEventDay; }
  /** A Conductor's correction steers the board only on the event day; practice runs the timetable. */
  get effectiveAnchor() { return this.isEventDay ? this.anchor : null; }
  /** Recomputes plan time from `realNow`. Pure: reads no clock. */
  syncPlan() { this.now = planNow(this.itinerary?.event_date ?? null, this.realNow); }
  syncNow() { this.realNow = clientClock.eventNow() ?? this.realNow; this.syncPlan(); }
  get here(): Current | null {
    if (!this.hasRoute) return null;
    return currentStop(this.stops, this.legs, this.now, { startAt: this.startAt, override: this.effectiveAnchor });
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

  // Everything Live shows about activity belongs to one scope: the route id plus the Chicago day.
  // When the scope changes the old rows are wrong at once, whether or not a reload succeeds, so a
  // scope change clears first and reloads second, and every read drops an answer from an earlier scope.
  private scopeKey = $state('');
  private scopeRoute = '';
  /** Scope entries that reloaded everything: a caller about to reload the same things skips it. */
  private scopeReloads = 0;
  private get currentScope() { return `${this.itinerary?.id ?? ''}|${this.today}`; }
  // Dates, not the ISO strings: pb.filter writes a Date in PocketBase's stored datetime form
  // ("2026-09-24 05:00:00.000Z"); a "T" string would compare as text and match nothing that day.
  private window() { const { start, end } = dayBounds(this.today); return { start: new Date(start), end: new Date(end) }; }

  /** Route or day changed: nothing on screen belongs to the new scope, so empty it now. */
  enterScope(reload = true) {
    this.scopeKey = this.currentScope;
    // The Conductor's position belongs to a route, not a day: it survives midnight, not a switch.
    const route = this.itinerary?.id ?? '';
    if (route !== this.scopeRoute) { this.anchorRead++; this.anchor = null; this.scopeRoute = route; }
    if (reload && this.itinerary) this.scopeReloads++;
    this.feedRead++; this.bulletinRead++; this.trainRead++;
    this.feed = { drinks: [], media: [], messages: [], reactions: [] };
    this.bulletins = []; this.ackedIds = []; this.acking = []; this.trips = [];
    // A practice day shows no alerts, whatever an earlier event-day route or read left behind.
    if (this.practice) { this.alertRead++; this.alerts = []; }
    if (reload && this.itinerary) {
      void this.loadAnchor(); void this.loadFeed(); void this.loadBulletins(); void this.loadTrains();
      if (!this.practice) void this.loadAlerts();
    }
  }
  async checkScope() { if (this.currentScope !== this.scopeKey) this.enterScope(); }

  async loadDay() {
    const sent = this.realNow.getTime();
    try {
      // The round trip is ignored: a second's error does not matter to which day it is.
      this.serverOffset = Date.parse((await fetchDay()).now) - sent;
    } catch { /* offline: keep the last offset; with none yet, `today` is this phone's own date */ }
    await this.checkScope();
  }

  private routeRead = 0;
  private routeRun: string | undefined;
  async loadRoute() {
    const request = ++this.routeRead, runId = clientClock.runId;
    if (clientClock.enabled && runId && this.routeRun !== runId) {
      this.itinerary = null; this.stops = []; this.legs = []; this.anchor = null;
      this.bulletins = []; this.ackedIds = []; this.acking = []; this.feed = { drinks: [], media: [], messages: [], reactions: [] };
      this.fromMirror = false; this.mirrorSavedAt = null; this.routeRun = runId; this.scopeKey = '';
      await scopeMirror(runId);
    }
    try {
      // Workbox also respects no-store: a cached HTTP success must not re-date an old plan.
      const itinerary = await resolveCurrentRoute();
      if (request !== this.routeRead || runId !== clientClock.runId) return;
      if (!itinerary) {
        const had = this.itinerary;
        this.itinerary = null; this.stops = []; this.legs = []; this.anchor = null;
        this.fromMirror = false; this.mirrorSavedAt = null;
        this.syncPlan();
        if (had) this.enterScope();
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
      const switched = this.itinerary?.id !== itinerary.id;
      this.itinerary = itinerary; this.stops = stops; this.legs = legs;
      this.fromMirror = false; this.mirrorSavedAt = null;
      this.syncPlan();
      // A different route is a new scope: clear the old route's activity now, then reload it all.
      if (switched) this.enterScope(); else await this.loadAnchor();
    } catch {
      // No signal: the last known plan is better than an empty screen, as long as it says so.
      const mirror = await readMirror();
      if (request !== this.routeRead || runId !== clientClock.runId) return;
      if (!mirror || (clientClock.enabled && clientClock.runId && mirror.runId !== clientClock.runId)) throw new Error('offline and no mirror');
      const switched = this.itinerary?.id !== mirror.itinerary.id;
      this.itinerary = mirror.itinerary;
      this.stops = mirror.stops;
      this.legs = mirror.legs;
      this.mirrorSavedAt = mirror.savedAt;
      this.fromMirror = true;
      this.syncPlan();
      if (switched) this.enterScope();
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
    const request = ++this.bulletinRead, scope = this.scopeKey;
    if (!this.itinerary) { this.bulletins = []; return; }
    try {
      const { start, end } = this.window(), id = this.itinerary.id;
      const [rows, acks] = await Promise.all([
        pb.collection('broadcasts').getFullList<Broadcast>({ filter: pb.filter('itinerary = {:id} && at >= {:start} && at < {:end}', { id, start, end }), sort: '-created', expand: 'created_by' }),
        pb.collection('broadcast_acks').getFullList<BroadcastAck>({ filter: pb.filter('user = {:u} && broadcast.itinerary = {:id} && broadcast.at >= {:start} && broadcast.at < {:end}', { u: pb.authStore.record?.id ?? '', id, start, end }) })
      ]);
      if (request !== this.bulletinRead || scope !== this.scopeKey) return;
      this.bulletins = rows;
      this.ackedIds = acks.map((a) => a.broadcast);
    } catch { /* offline: keep whatever this scope had (a new scope starts empty) */ }
  }

  private feedRead = 0;
  async loadFeed() {
    const request = ++this.feedRead, scope = this.scopeKey;
    const id = this.itinerary?.id;
    if (!id) { this.feed = { drinks: [], media: [], messages: [], reactions: [] }; return; }
    const { start, end } = this.window();
    const byStop = pb.filter('stop.itinerary = {:id} && at >= {:start} && at < {:end}', { id, start, end });
    const byRoute = pb.filter('itinerary = {:id} && at >= {:start} && at < {:end}', { id, start, end });
    const reactionsToday = pb.filter('itinerary = {:id} && created >= {:start} && created < {:end}', { id, start, end });
    try {
      const [drinks, media, messages, reactions] = await Promise.all([
        pb.collection('drink_entries').getFullList<DrinkEntry>({ filter: byStop, expand: 'user,stop', sort: 'at,action_order,created,id', cache: 'no-store' }),
        pb.collection('media').getFullList<Media>({ filter: byStop, expand: 'user', sort: 'at,created,id', cache: 'no-store' }),
        pb.collection('chat_messages').getFullList<ChatMessage>({ filter: byRoute, expand: 'user', sort: 'at,created,id', cache: 'no-store' }),
        pb.collection('reactions').getFullList<Reaction>({ filter: reactionsToday, cache: 'no-store' })
      ]);
      if (request !== this.feedRead || scope !== this.scopeKey || id !== this.itinerary?.id) return;
      this.feed = { drinks, media, messages, reactions };
      this.feedError = false;
    } catch { if (request === this.feedRead && scope === this.scopeKey) this.feedError = true; }
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
    const request = ++this.trainRead, revision = clientClock.revision, scope = this.scopeKey;
    const here = this.here;
    // The train goes to the next *different* station: with several bars at one station the literal
    // next stop is another bar here, and a trip from a station to itself does not exist.
    if (!here?.stop || !here.onwardStop || !this.itinerary) { this.trips = []; return; }
    try {
      const res = await fetchNext(here.stop.station_id, here.onwardStop.station_id, this.itinerary.event_date, this.now, this.practice);
      if (request !== this.trainRead || revision !== clientClock.revision || scope !== this.scopeKey) return;
      this.trips = res.trips;
      this.mode = res.mode;
      this.rtFetchedAt = res.fetchedAt;
    } catch { if (request === this.trainRead && revision === clientClock.revision && scope === this.scopeKey) this.trips = []; }
  }

  async loadAlerts() {
    const request = ++this.alertRead, revision = clientClock.revision;
    // Realtime alerts belong to today, not to the route's date: a practice day shows none.
    if (this.practice) { this.alerts = []; return; }
    // The route can turn out to be a practice one while this read is in flight.
    try { const res = await fetchAlerts(); if (request === this.alertRead && revision === clientClock.revision) this.alerts = this.practice ? [] : res.alerts; } catch { if (request === this.alertRead && revision === clientClock.revision) this.alerts = []; }
  }

  /** Starts the pollers and subscriptions. Returns the teardown; safe to call once per layout.
   *  Untracked: the layout calls this inside an `$effect`, and the first sync and loads read the very
   *  state they write (`realNow`, `itinerary`), which would otherwise re-run that effect forever. */
  start(): () => void { return untrack(() => this.begin()); }

  private begin(): () => void {
    let stopped = false;
    this.syncNow();
    const revisionRefresh = clientClock.onRevision(() => {
      this.syncNow();
      this.anchorRead++; this.feedRead++; this.bulletinRead++;
      this.trainRead++; this.alertRead++; this.trips = []; this.alerts = [];
      const reloads = this.scopeReloads;
      void this.loadRoute().then(() => {
        if (stopped) return;
        if (this.scopeReloads === reloads) { void this.loadBulletins(); void this.loadTrains(); void this.loadAlerts(); void this.loadFeed(); }
      }).catch(() => {});
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
    // The day first, so the first route load enters a scope on the server's day.
    // A load that entered a new scope has already asked for everything; a second train request
    // would race the first, and the later answer wins whatever it says.
    const reloads = this.scopeReloads;
    void this.loadDay().then(() => { if (!stopped) return this.loadRoute(); })
      .then(() => { if (stopped || this.scopeReloads !== reloads) return; void this.loadBulletins(); void this.loadTrains(); void this.loadFeed(); }).catch(() => {});
    void this.loadAlerts();
    void fetchStatus().then((s) => { if (stopped) return; this.rtFetchedAt = s.feeds?.tripupdates?.fetchedAt ?? null; this.mode = s.mode; }).catch(() => {});
    // `today` follows this phone's clock plus the server offset, so midnight is caught here without a fetch.
    const tick = setInterval(() => { this.wallNow = new Date(); this.syncNow(); void this.checkScope(); }, clientClock.enabled ? 250 : 15_000);
    const replayPoll = clientClock.enabled ? setInterval(() => { if (this.clockKnown) { void this.loadTrains(); void this.loadAlerts(); } }, 1000) : undefined;
    const poll = setInterval(() => { void this.loadDay(); refreshRoute(); void this.loadTrains(); void this.loadAlerts(); void this.loadFeed(); }, 30_000);
    // Unit tests run under Node, where there is no window.
    const online = () => void this.loadFeed();
    if (typeof window !== 'undefined') window.addEventListener('online', online);
    const unsubs = [
      // A route switch should not wait for the burst timer: loadRoute enters the new scope at once.
      subscribe('crawl_settings', '', refreshRoute),
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
