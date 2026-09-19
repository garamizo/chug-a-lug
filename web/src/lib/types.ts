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

export type Stop = RecordModel & {
  itinerary: string; order: number; name: string; kind: VenueKind; station_id: string; station_name: string;
  place_id: string; osm_id: string; address: string; lat: number; lon: number; hours: Hours | null; phone: string;
  website: string; confirmed_open: boolean; dwell_min: number; walk_min: number; notes: string; meet_point: string;
  photos_status: PhotosStatus;
};

export type StopPhoto = RecordModel & { stop: string; file: string; source: 'google' | 'user'; attribution: string };

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

export type Station = { id: string; name: string; lat: number; lon: number };
export type Line = { routeId: string; name: string; color: string; stations: Station[] };

export type Venue = {
  source: 'osm' | 'google'; id: string; name: string; kind: VenueKind; lat: number; lon: number;
  address?: string; hours?: Hours; phone?: string; website?: string; distanceM?: number;
};

export type NextTrip = {
  tripId: string; routeId: string; headsign: string; schedDepart: string; schedArrive: string;
  liveDepart: null; liveArrive: null; delayMin: null; status: 'scheduled';
};

export type AttachResult = { status: 'done' | 'failed'; photos: number; message?: string };
