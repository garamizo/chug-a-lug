import { simSetup } from '../../labels.ts';
import type { ScenarioClock } from '../../sim/config.ts';
export type Scenario = ScenarioClock & { title: string; stops: {
  name: string; station_id: string; station_name: string; kind: string; dwell_min: number; walk_min: number;
}[] };
// The local launcher owns auth and checks HTTP errors. No response body is logged.
export type SeedRequest = (method: string, path: string, body?: Record<string, unknown>) => Promise<any>;
export async function seedTimetable(request: SeedRequest, clock: ScenarioClock & { runId: string; recordingId?: string | null }, scenario: Scenario,
  passwords: { crew: string; conductor: string }) {
  for (const collection of ['simulation_clock', 'users', 'itineraries', 'stops', 'checkins', 'drink_entries', 'broadcasts', 'media']) {
    const rows = await request('GET', `/api/collections/${collection}/records?perPage=1`);
    if (rows.totalItems !== 0) throw new Error(simSetup.notEmpty);
  }
  await request('POST', '/api/collections/simulation_clock/records', {
    id: 'simulationclock', run_id: clock.runId, revision: 1, epoch_start: clock.epochStart,
    wall_start: new Date().toISOString(), rate: 0, resume_rate: 1, service_date: clock.serviceDate,
    source: clock.recordingId ? 'recording' : 'timetable', recording_id: clock.recordingId ?? '', window_start: clock.windowStart, window_end: clock.windowEnd
  });
  const owner = await request('POST', '/api/crawl/login', { name: 'Rehearsal Conductor', password: passwords.conductor });
  await request('POST', '/api/crawl/login', { name: 'Rehearsal Crew', password: passwords.crew });
  const itinerary = await request('POST', '/api/collections/itineraries/records', {
    title: scenario.title, event_date: clock.serviceDate, start_time: clock.startTime, created_by: owner.record.id
  });
  const stopIds: string[] = [];
  for (const [i, stop] of scenario.stops.entries()) {
    const row = await request('POST', '/api/collections/stops/records', { ...stop, order: i + 1, itinerary: itinerary.id });
    stopIds.push(row.id);
  }
  await request('PATCH', `/api/collections/itineraries/records/${itinerary.id}`, { status: 'locked' });
  return { itineraryId: itinerary.id as string, stopIds };
}
export function verifySeedLegs(stopIds: string[], legs: { from_stop: string; to_stop: string; kind: string; depart_at: string; arrive_at: string }[], clock: ScenarioClock): boolean {
  if (legs.length !== stopIds.length - 1) return false;
  return stopIds.slice(0, -1).every((id, i) => {
    const leg = legs.find(l => l.from_stop === id && l.to_stop === stopIds[i + 1]);
    return leg && ['train', 'walk'].includes(leg.kind) &&
      Date.parse(leg.depart_at) >= Date.parse(clock.windowStart) &&
      Date.parse(leg.arrive_at) >= Date.parse(leg.depart_at) && Date.parse(leg.arrive_at) <= Date.parse(clock.windowEnd);
  });
}
