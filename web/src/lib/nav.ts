// Overlays that the back gesture closes. SvelteKit shallow routing keeps the page mounted, so the
// Departure Board keeps counting under a stop sheet or a photo.
import { pushState, replaceState } from '$app/navigation';
import { page } from '$app/state';
import type { LightboxItem } from '$lib/types';

function withStop(id: string | null): string {
  const url = new URL(page.url);
  if (id) url.searchParams.set('stop', id); else url.searchParams.delete('stop');
  return url.pathname + url.search;
}

/**
 * `pushState`/`replaceState` update `page.state` but not `page.url` (SvelteKit's shallow routing
 * only touches the address bar) — a real navigation (a deep link) is the only thing that updates
 * `page.url` itself. So once `page.state` has ever been given a `stop` key — even a cleared one —
 * it is the source of truth; only a pristine `page.state` (a fresh load) falls back to the URL.
 */
export const sheetStopId = (): string | null =>
  'stop' in page.state ? (page.state.stop ?? null) : page.url.searchParams.get('stop');
export function openStop(id: string) { pushState(withStop(id), { ...page.state, stop: id, sheet: true }); }
export function pageStop(id: string) { replaceState(withStop(id), { ...page.state, stop: id }); }
/** A pushed sheet goes back; a deep-linked one has nothing behind it in this app, so it is replaced. */
export function closeStop() {
  if (page.state.sheet) history.back();
  else replaceState(withStop(null), { ...page.state, stop: null, sheet: undefined });
}
export function openLightbox(items: LightboxItem[], index: number) { pushState('', { ...page.state, lightbox: { items, index } }); }
export function closeLightbox() { if (page.state.lightbox) history.back(); }
