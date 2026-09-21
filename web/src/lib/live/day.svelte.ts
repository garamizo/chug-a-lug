// The live day, owned by the app layout and read by every screen: one poller, one set of
// subscriptions, one answer to "where are we". M4 replaces `now` with the sim clock and nothing
// else here changes.
import { pb, subscribe } from '$lib/pb';
import { localToUtc, parseHm, todayInTz } from '$lib/time';
import { currentStop, type Current } from './current';
import { pickTrip } from './board';
import { fetchAlerts, fetchNext, fetchStatus } from './feed';
import type { Alert, Broadcast, BroadcastAck, Checkin, FeedMode, Itinerary, Leg, NextTrip, Stop } from '$lib/types';

export class LiveDay {
  itinerary = $state<Itinerary | null>(null);
  stops = $state<Stop[]>([]);
  legs = $state<Leg[]>([]);
  anchor = $state<{ stopId: string; at: string } | null>(null);
  trips = $state<NextTrip[]>([]);
  alerts = $state<Alert[]>([]);
  bulletins = $state<Broadcast[]>([]);
  ackedIds = $state<string[]>([]);
  mode = $state<FeedMode>('schedule_only');
  rtFetchedAt = $state<string | null>(null);
  now = $state(new Date());

  get startAt(): Date {
    return this.itinerary ? localToUtc(this.itinerary.event_date, parseHm(this.itinerary.start_time)) : new Date();
  }
  /** The board only takes over on the day itself. */
  get isToday(): boolean {
    return !!this.itinerary && this.itinerary.event_date === todayInTz(this.now);
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
    return this.bulletins.find((b) => !this.ackedIds.includes(b.id)) ?? null;
  }

  async loadRoute() {
    const list = await pb.collection('itineraries').getFullList<Itinerary>({ filter: pb.filter('status = "locked"'), sort: '-locked_at' });
    this.itinerary = list[0] ?? null;
    if (!this.itinerary) { this.stops = []; this.legs = []; return; }
    const filter = pb.filter('itinerary = {:id}', { id: this.itinerary.id });
    [this.stops, this.legs] = await Promise.all([
      pb.collection('stops').getFullList<Stop>({ filter, sort: 'order,created' }),
      pb.collection('legs').getFullList<Leg>({ filter })
    ]);
    await this.loadAnchor();
  }

  async loadAnchor() {
    try {
      const rows = await pb.collection('checkins').getList<Checkin>(1, 20, { filter: pb.filter('kind = "at_stop"'), sort: '-at', expand: 'user' });
      const hit = rows.items.find((c) => c.expand?.user?.is_admin && c.stop);
      this.anchor = hit ? { stopId: hit.stop, at: hit.at } : null;
    } catch { this.anchor = null; }
  }

  async loadBulletins() {
    if (!this.itinerary) { this.bulletins = []; return; }
    try {
      const filter = pb.filter('itinerary = {:id}', { id: this.itinerary.id });
      const [rows, acks] = await Promise.all([
        pb.collection('broadcasts').getFullList<Broadcast>({ filter, sort: '-created' }),
        pb.collection('broadcast_acks').getFullList<BroadcastAck>({ filter: pb.filter('user = {:u}', { u: pb.authStore.record?.id ?? '' }) })
      ]);
      this.bulletins = rows;
      this.ackedIds = acks.map((a) => a.broadcast);
    } catch { /* offline: keep whatever we had */ }
  }

  async loadTrains() {
    const here = this.here;
    // The train goes to the next *different* station: with several bars at one station the literal
    // next stop is another bar here, and a trip from a station to itself does not exist.
    if (!here?.stop || !here.onwardStop || !this.itinerary) { this.trips = []; return; }
    try {
      const res = await fetchNext(here.stop.station_id, here.onwardStop.station_id, this.itinerary.event_date, this.now);
      this.trips = res.trips;
      this.mode = res.mode;
      this.rtFetchedAt = res.fetchedAt;
    } catch { this.trips = []; }
  }

  async loadAlerts() {
    try { this.alerts = (await fetchAlerts()).alerts; } catch { this.alerts = []; }
  }

  /** Starts the pollers and subscriptions. Returns the teardown; safe to call once per layout. */
  start(): () => void {
    void this.loadRoute().then(() => { void this.loadBulletins(); void this.loadTrains(); }).catch(() => {});
    void this.loadAlerts();
    void fetchStatus().then((s) => { this.rtFetchedAt = s.feeds?.tripupdates?.fetchedAt ?? null; this.mode = s.mode; }).catch(() => {});
    const tick = setInterval(() => { this.now = new Date(); }, 15_000);
    const poll = setInterval(() => { void this.loadTrains(); void this.loadAlerts(); }, 30_000);
    const unsubs = [
      subscribe('stops', '', () => void this.loadRoute()),
      subscribe('legs', '', () => void this.loadRoute()),
      subscribe('checkins', '', () => void this.loadAnchor()),
      subscribe('broadcasts', '', () => void this.loadBulletins()),
      subscribe('broadcast_acks', '', () => void this.loadBulletins())
    ];
    return () => { clearInterval(tick); clearInterval(poll); unsubs.forEach((u) => u()); };
  }
}

export const liveDay = new LiveDay();
