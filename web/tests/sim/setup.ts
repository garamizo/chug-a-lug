import PocketBase from 'pocketbase';
import { readFile } from 'node:fs/promises';
export async function admin() {
  const pb = new PocketBase(process.env.PB_URL);
  pb.autoCancellation(false);
  await pb.collection('_superusers').authWithPassword(process.env.PB_ADMIN_EMAIL!, process.env.PB_ADMIN_PASSWORD!);
  return pb;
}
export async function seed() {
  const pb = await admin();
  for (const collection of ['checkins', 'drink_entries', 'broadcast_acks', 'media']) {
    if ((await pb.collection(collection).getList(1, 1)).totalItems !== 0) throw new Error('Rehearsal database was not fresh');
  }
  const manifest = JSON.parse(await readFile('tests/fixtures/sim/recording/manifest.json', 'utf8'));
  await pb.collection('simulation_clock').create({ id: 'simulationclock', run_id: 'browser-fixture', revision: 1,
    epoch_start: manifest.windowStart, wall_start: new Date().toISOString(), rate: 0, resume_rate: 1,
    service_date: manifest.serviceDate, source: 'recording', recording_id: 'recording', window_start: manifest.windowStart, window_end: manifest.windowEnd });
  const conductor = await pb.send('/api/crawl/login', { method: 'POST', body: { name: 'Rehearsal Conductor', password: process.env.ADMIN_PASSWORD } });
  const itinerary = await pb.collection('itineraries').create({ title: 'Browser rehearsal', event_date: manifest.serviceDate, start_time: '12:00', created_by: conductor.record.id });
  const first = await pb.collection('stops').create({ itinerary: itinerary.id, order: 1, name: 'Rehearsal Tap', kind: 'bar', station_id: 'CUS', station_name: 'Union Station', dwell_min: 25, walk_min: 2, direction: 'out' });
  await pb.collection('stops').create({ itinerary: itinerary.id, order: 2, name: 'Rehearsal Round', kind: 'bar', station_id: 'CUS', station_name: 'Union Station', dwell_min: 5, walk_min: 0, direction: 'out' });
  await pb.collection('stops').create({ itinerary: itinerary.id, order: 3, name: 'Rehearsal Finish', kind: 'bar', station_id: 'LAGRANGE', station_name: 'La Grange Road', dwell_min: 60, walk_min: 2, direction: 'out' });
  await pb.collection('itineraries').update(itinerary.id, { status: 'locked' });
  // Wait for the real hook recompute to publish; never seed synthetic leg times.
  for (let i = 0; i < 100; i++) {
    const legs = await pb.collection('legs').getFullList({ filter: `itinerary="${itinerary.id}"` });
    if (legs.length === 2) return { pb, itinerary, first };
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Seed recompute did not publish');
}
