import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { metra } from '$lib/server/metra';
import { MetraSetupError } from '$lib/server/metra/provider';
import { ClockServiceError } from '$lib/server/sim/service';
import { copy } from '$lib/labels';
import { modeFor } from '$lib/metra/live';
import type { MetraStatus } from '$lib/types';

export const GET: RequestHandler = async ({ request }) => {
  await requireUser(request);
  let snapshot;
  try {
    snapshot = await metra.snapshot();
  } catch (e) {
    throw error(503, e instanceof MetraSetupError ? copy.simFeedUnavailable : e instanceof ClockServiceError ? copy.simUnavailable : copy.metraUnavailable);
  }
  const metadata = { source: snapshot.source, revision: snapshot.revision, diagnostics: snapshot.diagnostics };
  const st = snapshot.staticStatus;
  const rt = snapshot.status;
  const feeds = Object.fromEntries(
    (['positions', 'tripupdates', 'alerts'] as const).map((n) => [n, {
      fetchedAt: rt.feeds[n].fetchedAt, ageSec: rt.feeds[n].ageSec, mode: modeFor(rt.feeds[n])
    }])
  ) as MetraStatus['feeds'];
  const body: MetraStatus = {
    ...metadata,
    staticPublishedAt: st.publishedAt, staticSource: st.source,
    rtFetchedAt: rt.fetchedAt, rtAgeSec: rt.ageSec,
    // The board runs on trip updates, so that is the mode this page reports.
    mode: modeFor(snapshot.status.feeds.tripupdates),
    feeds
  };
  return json(body);
};
