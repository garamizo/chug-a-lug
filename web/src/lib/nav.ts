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

export const sheetStopId = (): string | null => page.url.searchParams.get('stop');
export function openStop(id: string) { pushState(withStop(id), { ...page.state, sheet: true }); }
export function pageStop(id: string) { replaceState(withStop(id), { ...page.state }); }
/** A pushed sheet goes back; a deep-linked one has nothing behind it in this app, so it is replaced. */
export function closeStop() {
  if (page.state.sheet) history.back();
  else replaceState(withStop(null), { ...page.state, sheet: undefined });
}
export function openLightbox(items: LightboxItem[], index: number) { pushState('', { ...page.state, lightbox: { items, index } }); }
export function closeLightbox() { if (page.state.lightbox) history.back(); }
