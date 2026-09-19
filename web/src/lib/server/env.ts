// The only module that reads private env. Everything else takes config as parameters so it can be unit-tested.
import { env } from '$env/dynamic/private';
import { resolve } from 'node:path';

export const serverEnv = {
  get pbUrl() { return env.PB_URL || 'http://127.0.0.1:8090'; },
  get pbAdminEmail() { return env.PB_ADMIN_EMAIL || ''; },
  get pbAdminPassword() { return env.PB_ADMIN_PASSWORD || ''; },
  get internalSecret() { return env.INTERNAL_SECRET || ''; },
  get googleKey() { return env.GOOGLE_PLACES_KEY || ''; },
  get gtfsUrl() { return env.GTFS_URL || 'https://schedules.metrarail.com/gtfs/schedule.zip'; },
  get gtfsPublishedUrl() { return env.GTFS_PUBLISHED_URL || 'https://schedules.metrarail.com/gtfs/published.txt'; },
  get overpassUrl() { return env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter'; },
  /** Runtime state root: data/ next to the repo in dev, /data in the container. */
  get dataDir() { return env.DATA_DIR || resolve(process.cwd(), '..', 'data'); }
};
