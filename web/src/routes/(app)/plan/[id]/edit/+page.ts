import { preloadDraft } from '$lib/draft';
import type { PageLoad } from './$types';
// Not awaited: the page renders at once and picks the read up when it mounts.
export const load: PageLoad = ({ params }) => ({ id: params.id, early: preloadDraft(params.id) });
