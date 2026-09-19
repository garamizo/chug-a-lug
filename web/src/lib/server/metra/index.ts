import { serverEnv } from '$lib/server/env';
import { createStaticLoader } from './static';

export const metra = createStaticLoader({ url: serverEnv.gtfsUrl, publishedUrl: serverEnv.gtfsPublishedUrl, dataDir: serverEnv.dataDir });
