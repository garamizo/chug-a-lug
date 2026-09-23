// One-shot regular-stack initialization. Never runs inside an ordinary application request.
import { seedTimetable, type Scenario, type SeedRequest } from './seed.ts';
import { copy, rehearsalBulletins } from '../../labels.ts';
export const SHARED_RUN = 'shared-rehearsal';
export type SharedMarker = { phase: 'seeding' | 'ready'; runId: string; itineraryId?: string };
export async function initializeRehearsal(config: {
  request: SeedRequest; scenario: Scenario; passwords: { crew: string; conductor: string };
  readMarker: () => Promise<SharedMarker | null>; writeMarker: (marker: SharedMarker) => Promise<void>;
  finish: (itineraryId: string, stopIds: string[]) => Promise<void>;
}) {
  const runId = config.scenario.runId ?? SHARED_RUN;
  const marker = await config.readMarker();
  if (marker) {
    if (marker.runId !== runId || marker.phase !== 'ready' || !marker.itineraryId) throw new Error(copy.rehearsalSetupIncomplete);
    const clock = await config.request('GET', '/api/collections/simulation_clock/records/simulationclock');
    if (clock.run_id !== runId || clock.source !== (config.scenario.recordingId === null ? 'timetable' : 'recording') || clock.recording_id !== (config.scenario.recordingId === null ? '' : config.scenario.recordingId ?? 'recording') ||
      clock.service_date !== config.scenario.serviceDate || Date.parse(clock.window_start) !== Date.parse(config.scenario.windowStart) ||
      Date.parse(clock.window_end) !== Date.parse(config.scenario.windowEnd)) throw new Error(copy.simUnavailable);
    return;
  }
  await config.writeMarker({ phase: 'seeding', runId });
  const seeded = await seedTimetable(config.request, { ...config.scenario, runId, recordingId: config.scenario.recordingId === null ? null : config.scenario.recordingId ?? 'recording' }, config.scenario, config.passwords);
  await config.finish(seeded.itineraryId, seeded.stopIds);
  for (const body of rehearsalBulletins) {
    await config.request('POST', '/api/collections/broadcasts/records', { itinerary: seeded.itineraryId, created_by: seeded.ownerId, kind: 'message', body });
  }
  await config.request('PATCH', '/api/collections/simulation_clock/records/simulationclock', { rate: 10, resume_rate: 10, revision: 2, wall_start: new Date().toISOString() });
  await config.writeMarker({ phase: 'ready', runId, itineraryId: seeded.itineraryId });
}
