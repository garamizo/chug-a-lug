import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { metra } from '$lib/server/metra';

export const GET: RequestHandler = async ({ request }) => {
  await requireUser(request);
  const s = await metra.getSchedule();
  return json({ publishedAt: s.publishedAt, lines: s.lines });
};
