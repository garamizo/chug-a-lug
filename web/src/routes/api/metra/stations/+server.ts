import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { metra } from '$lib/server/metra';

export const GET: RequestHandler = async ({ request }) => {
  await requireUser(request);
  let s;
  try {
    s = await metra.getSchedule();
  } catch {
    throw error(503, 'Metra schedule is not available yet. Try again in a minute.');
  }
  return json({ publishedAt: s.publishedAt, lines: s.lines });
};
