import type { RecordModel } from 'pocketbase';

export type UserRecord = RecordModel & {
  name: string; name_key: string; is_admin: boolean; share_position: boolean; home_station: string; left_early: boolean;
};

export type ItineraryStatus = 'draft' | 'locked' | 'archived';
export type Itinerary = RecordModel & {
  title: string; status: ItineraryStatus; event_date: string; start_time: string; vote_open: boolean; created_by: string; locked_at: string;
};

export type Hours = { source: 'osm'; raw: string } | { source: 'google'; weekday: string[] };
export type VenueKind = 'bar' | 'restaurant' | 'other';
export type PhotosStatus = 'none' | 'pending' | 'done' | 'failed';

/** One venue, shared by every stop that points at it. Written only by the server. */
export type Place = RecordModel & {
  ref: string; source: 'google' | 'osm'; place_id: string; osm_id: string; name: string; kind: VenueKind;
  lat: number; lon: number; address: string; rating: number | null; rating_count: number | null; hours: Hours | null;
  phone: string; website: string; maps_url: string; station_id: string; distance_m: number | null;
  photos: string[]; photo_refs: string[] | null; photo_attributions: string[] | null; details_at: string; fetched_at: string;
};
export type PlaceLookup = RecordModel & { station_id: string; source: 'google' | 'osm'; count: number; fetched_at: string };

export type Stop = RecordModel & {
  itinerary: string; order: number; name: string; kind: VenueKind; station_id: string; station_name: string;
  place: string; place_id: string; osm_id: string; address: string; lat: number; lon: number; hours: Hours | null; phone: string;
  website: string; confirmed_open: boolean; dwell_min: number; walk_min: number; notes: string; meet_point: string;
  photos_status: PhotosStatus; direction: 'out' | 'back' | ''; expand?: { place?: Place };
};

export type StopPhoto = RecordModel & { stop: string; file: string; source: 'google' | 'user'; attribution: string };

/**
 * Where someone is. M2 writes only the Conductor's `at_stop` correction from the Departure Board;
 * M3 opens the same collection to the Crew for Punch and the roster.
 */
export type Checkin = RecordModel & {
  user: string; stop: string; kind: 'at_stop' | 'on_train'; at: string;
  expand?: { user?: UserRecord };
};

export type Segment =
  | { kind: 'train'; tripId: string; routeId: string; headsign: string; from: string; to: string; dep: string; arr: string }
  | { kind: 'walk'; minutes: number; from: string; to: string };

export type Leg = RecordModel & {
  itinerary: string; from_stop: string; to_stop: string; kind: 'train' | 'walk' | 'impossible';
  ready_at: string; depart_at: string; arrive_at: string; segments: Segment[]; computed_at: string;
};

export type Vote = RecordModel & { user: string; target_collection: string; target_id: string; value: 'up' | 'down' };
export type Comment = RecordModel & { user: string; target_collection: string; target_id: string; body: string; expand?: { user?: UserRecord } };
export type ApprovalVote = RecordModel & { itinerary: string; user: string; value: 'go' | 'nogo'; expand?: { user?: UserRecord } };

/** `served` is set when the stations were asked for a date: false means no train stops there that day. */
export type Station = { id: string; name: string; lat: number; lon: number; served?: boolean };
export type Line = { routeId: string; name: string; color: string; stations: Station[] };

export type Venue = {
  source: 'osm' | 'google'; id: string; name: string; kind: VenueKind; lat: number; lon: number;
  address?: string; hours?: Hours; phone?: string; website?: string; distanceM?: number;
  /** Google rating (1 to 5) and review count; absent for OpenStreetMap results. */
  rating?: number; ratingCount?: number;
  /** The `places` record id, when the venue has been stored. */
  placeRef?: string;
};

/** `live*` equal the scheduled times when no TripUpdate covers the trip: Metra means on time. */
export type NextTrip = {
  tripId: string; routeId: string; headsign: string; schedDepart: string; schedArrive: string;
  liveDepart: string | null; liveArrive: string | null; delayMin: number | null;
  status: 'scheduled' | 'live';
};

/** How much the server trusts its train times right now. */
export type FeedMode = 'live' | 'stale' | 'schedule_only';

/**
 * `mode` is the tripupdates mode — the one the Departure Board actually runs on — so the status page
 * agrees with the board. `rtFetchedAt` / `rtAgeSec` are the newest fetch of any feed, and `feeds` breaks
 * it down so an operator can see which one is failing.
 */
export type MetraStatus = {
  staticPublishedAt: string; staticSource: string;
  rtFetchedAt: string | null; rtAgeSec: number | null; mode: FeedMode;
  feeds: Record<'positions' | 'tripupdates' | 'alerts', { fetchedAt: string | null; ageSec: number | null; mode: FeedMode }>;
};

/** A Metra service alert, trimmed to what the UI shows. `id` is the feed's entity id and is stable. */
export type Alert = {
  id: string; effect: string; header: string; body: string;
  startsAt: string | null; endsAt: string | null; stationIds: string[];
};

export type AttachResult = { status: 'done' | 'failed'; photos: number; message?: string };
