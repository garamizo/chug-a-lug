import { adminPb } from '$lib/server/pb';
import { serverEnv } from '$lib/server/env';
import { createClockService } from './service';

export const CLOCK_RECORD_ID = 'simulationclock';
const utc = (value: unknown) => typeof value === 'string' ? value.replace(' ', 'T') : value;

// Lazy storage access: normal mode never authenticates or reads a simulation record.
export const simulationClock = createClockService({
  enabled: () => serverEnv.simEnabled,
  runId: () => serverEnv.simRunId,
  async read() {
    const pb = await adminPb();
    const row = await pb.collection('simulation_clock').getOne(CLOCK_RECORD_ID);
    return {
      runId: row.run_id, revision: row.revision, epochStart: utc(row.epoch_start), wallStart: utc(row.wall_start),
      rate: row.rate, resumeRate: row.resume_rate, serviceDate: row.service_date,
      source: row.source, recordingId: row.recording_id || null,
      windowStart: utc(row.window_start), windowEnd: utc(row.window_end)
    };
  },
  async write(state) {
    const pb = await adminPb();
    // The control endpoint never changes run identity, source, service date or playback bounds.
    await pb.collection('simulation_clock').update(CLOCK_RECORD_ID, {
      revision: state.revision, epoch_start: state.epochStart, wall_start: state.wallStart,
      rate: state.rate, resume_rate: state.resumeRate
    });
  }
});
