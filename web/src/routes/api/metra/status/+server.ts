import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { metra, metraRt } from '$lib/server/metra';
import { modeFor } from '$lib/metra/live';
import type { MetraStatus } from '$lib/types';

export const GET: RequestHandler = async ({ request }) => {
  await requireUser(request);
  try {
    await metra.getSchedule();
  } catch {
    throw error(503, 'Metra schedule is not available yet. Try again in a minute.');
  }
  metraRt.start();
  const st = metra.status();
  const rt = metraRt.status();
  const feeds = Object.fromEntries(
    (['positions', 'tripupdates', 'alerts'] as const).map((n) => [n, {
      fetchedAt: rt.feeds[n].fetchedAt, ageSec: rt.feeds[n].ageSec, mode: modeFor(rt.feeds[n])
    }])
  ) as MetraStatus['feeds'];
  const body: MetraStatus = {
    staticPublishedAt: st.publishedAt, staticSource: st.source,
    rtFetchedAt: rt.fetchedAt, rtAgeSec: rt.ageSec,
    // The board runs on trip updates, so that is the mode this page reports.
    mode: modeFor(metraRt.statusOf('tripupdates')),
    feeds
  };
  return json(body);
};
