// Whether the page on screen is the one the app opened on. On the event day opening the app lands
// on Live, but a tap on the logo from inside the app has to reach Home.
//
// A full page load (the update switch) would otherwise look like a fresh open, so the moved state
// is kept in sessionStorage across it and restored when the app starts.
export const LANDING_KEY = 'chugalug:landing-moved';

export class Landing {
  private moved = false;
  /** Called after every navigation with the path it came from (null on the first load). */
  noteNavigation(fromPath: string | null) {
    // Signing in is still opening the app.
    if (fromPath && fromPath !== '/login') this.moved = true;
  }
  get isEntry(): boolean { return !this.moved; }

  /** Saves the moved state before a full load. Storage failures are ignored. */
  persist(storage: Pick<Storage, 'setItem'> | null): void {
    if (!storage) return;
    try {
      storage.setItem(LANDING_KEY, this.moved ? '1' : '0');
    } catch {
      // Private mode or blocked storage: the state simply does not survive the load.
    }
  }

  /**
   * Restores the moved state saved before a full load. A reload is the person's own, so it is an
   * entry again whatever was stored. Storage failures leave the state untouched.
   */
  restore(storage: Pick<Storage, 'getItem'> | null, navigationType: string | undefined): void {
    if (!storage || navigationType === 'reload') return;
    try {
      this.moved = storage.getItem(LANDING_KEY) === '1';
    } catch {
      // Blocked storage: stay an entry, as without storage.
    }
  }
}

/** sessionStorage, or null where it cannot be reached (Safari private mode, no DOM). */
export function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The type of this page load ('navigate', 'reload', 'back_forward'), if the browser reports it. */
export function navType(): string | undefined {
  try {
    return (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type;
  } catch {
    return undefined;
  }
}

export const landing = new Landing();
if (typeof window !== 'undefined') landing.restore(safeSession(), navType());
