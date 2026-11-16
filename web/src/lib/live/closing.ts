// Closing Time's reel opens itself once per night per phone. Which night is the route, the server's
// Chicago day and the simulation run; whether this phone has played it is a per-device marker like
// the alert read markers in `seen.ts`, guarded the same way because a private window, cleared site
// data or a blocked store all make localStorage throw.
const SHOWN = 'chugalug.closingShown';

export type ClosingScope = { itinerary: string; date: string; runId: string | null };

export const closingKey = (s: ClosingScope): string => `${s.itinerary}:${s.date}:${s.runId ?? ''}`;

/**
 * Open the reel on its own only when it is ready, this phone has not played it, the user has not
 * already entered and left it this session, nothing else is open over Live and practice is not quiet.
 */
export function shouldAutoOpen(o: { ready: boolean; shown: boolean; leftThisSession: boolean; overlayOpen: boolean; quiet: boolean }): boolean {
  return o.ready && !o.shown && !o.leftThisSession && !o.overlayOpen && !o.quiet;
}

/** Keys written this session: shared by every store, so an unwritable localStorage still opens it once. */
const memory = new Set<string>();

function readShown(): Set<string> {
  try {
    const raw = localStorage.getItem(SHOWN);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

/** Reels this phone has started playing. Written when playback starts, never when one is only scheduled. */
export function closingStore(): { has(key: string): boolean; add(key: string): void } {
  return {
    has: (key) => memory.has(key) || readShown().has(key),
    add: (key) => {
      memory.add(key);
      try {
        const next = readShown();
        next.add(key);
        localStorage.setItem(SHOWN, JSON.stringify([...next]));
      } catch {
        // Memory still holds it: the reel will not open itself again before the app is reloaded.
      }
    }
  };
}

/** In memory only: reels entered and left before they played, which must not open again this session. */
export const closingSession: { left: Set<string> } = { left: new Set() };

/**
 * Whether the history entry before the reel is Live, so closing it may go back: the reel was opened from
 * Live by a link or `goto`, or Forward took one step from Live to it. Back from Live into the reel puts
 * Live ahead of it, not behind; a direct entry or a reload has nothing of the app's behind it.
 */
export function liveIsBehind(nav: { type: string; delta?: number | null; from: { url: URL | null } | null }): boolean {
  // SvelteKit's first navigation has a `from` whose url is null.
  if (nav.from?.url?.pathname !== '/live') return false;
  return nav.type === 'link' || nav.type === 'goto' || (nav.type === 'popstate' && nav.delta === 1);
}
