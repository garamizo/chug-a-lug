import { serverEnv } from '$lib/server/env';
import { createStaticLoader } from './static';
import { createRealtimeLoader } from './realtime';

// The zip is cached under <dataDir>/gtfs (a bind mount in Compose, so it outlives the container);
// published.txt is checked once a day for a new timetable.
export const metra = createStaticLoader({ url: serverEnv.gtfsUrl, publishedUrl: serverEnv.gtfsPublishedUrl, dataDir: serverEnv.dataDir, refreshMs: 24 * 60 * 60_000 });

// One poller per server process. It starts on the first request that needs realtime, not at import
// time, so tests and the build never open a socket. Without a token it stays disabled and every
// endpoint reports schedule_only.
export const metraRt = createRealtimeLoader({ base: serverEnv.metraRtBase, token: serverEnv.metraToken });
