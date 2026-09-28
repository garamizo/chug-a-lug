import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminPb, requireUser } from '$lib/server/pb';
import { checkTitle } from '$lib/server/routeTitle';

// The locked editor stages a rename; this lets it say "taken" on blur rather than at Save.
export const GET: RequestHandler = async ({ request, url }) => {
  await requireUser(request);
  const result = await checkTitle(await adminPb(), url.searchParams.get('title') ?? '', url.searchParams.get('route') ?? '');
  if (!result.ok) throw error(400, result.message);
  return json({ ok: true });
};
