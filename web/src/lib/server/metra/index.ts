import { serverEnv } from '$lib/server/env';
import { createStaticLoader } from './static';

// The zip is cached under <dataDir>/gtfs (a bind mount in Compose, so it outlives the container);
// published.txt is checked once a day for a new timetable.
export const metra = createStaticLoader({ url: serverEnv.gtfsUrl, publishedUrl: serverEnv.gtfsPublishedUrl, dataDir: serverEnv.dataDir, refreshMs: 24 * 60 * 60_000 });
