// One-shot regular-stack initialization. Never runs inside an ordinary application request.
import { seedTimetable, type Scenario, type SeedRequest } from './seed.ts';
import { copy } from '../../labels.ts';
export const SHARED_RUN = 'shared-rehearsal';
export type SharedMarker = { phase: 'seeding' | 'ready'; runId: string; itineraryId?: string };
export async function initializeRehearsal(config: {
  request: SeedRequest; scenario: Scenario; passwords: { crew: string; conductor: string };
  readMarker: () => Promise<SharedMarker | null>; writeMarker: (marker: SharedMarker) => Promise<void>;
  finish: (itineraryId: string, stopIds: string[]) => Promise<void>;
}) {
  const marker = await config.readMarker();
  if (marker) {
    if (marker.runId !== SHARED_RUN || marker.phase !== 'ready' || !marker.itineraryId) throw new Error(copy.rehearsalSetupIncomplete);
    const clock = await config.request('GET', '/api/collections/simulation_clock/records/simulationclock');
    if (clock.run_id !== SHARED_RUN || clock.source !== 'recording' || clock.recording_id !== 'recording' ||
      clock.service_date !== config.scenario.serviceDate || Date.parse(clock.window_start) !== Date.parse(config.scenario.windowStart) ||
      Date.parse(clock.window_end) !== Date.parse(config.scenario.windowEnd)) throw new Error(copy.simUnavailable);
    return;
  }
  await config.writeMarker({ phase: 'seeding', runId: SHARED_RUN });
  const seeded = await seedTimetable(config.request, { ...config.scenario, runId: SHARED_RUN, recordingId: 'recording' }, config.scenario, config.passwords);
  await config.finish(seeded.itineraryId, seeded.stopIds);
  await config.writeMarker({ phase: 'ready', runId: SHARED_RUN, itineraryId: seeded.itineraryId });
}
