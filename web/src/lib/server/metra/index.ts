import { serverEnv } from '$lib/server/env';
import { simulationClock } from '$lib/server/sim/clock';
import { createStaticLoader } from './static';
import { createRealtimeLoader } from './realtime';
import { createMetraProvider } from './provider';

// Neither loader opens a socket until selected. Simulation never starts the live poller.
export const metra = createMetraProvider({
  readContext: () => simulationClock.readContext(),
  liveStatic: createStaticLoader({ url: serverEnv.gtfsUrl, publishedUrl: serverEnv.gtfsPublishedUrl,
    dataDir: serverEnv.dataDir, refreshMs: 24 * 60 * 60_000 }),
  liveRealtime: createRealtimeLoader({ base: serverEnv.metraRtBase, token: serverEnv.metraToken }),
  recordingsDir: serverEnv.simRecordingsDir, timetableUrl: serverEnv.gtfsUrl
});
