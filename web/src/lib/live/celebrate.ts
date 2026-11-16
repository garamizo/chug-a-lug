// Which Golden Spike the winner's phone celebrates now. Pure decisions over the current timeline, with
// an injected clock and store, so the overlay only renders the head. Nothing here is shared: the
// marks are per device, like `seen.ts`, and losing them at worst replays a still-fresh award.
import type { SpikeEvent } from './spikes';

export type CelebrationScope = { itinerary: string; date: string; runId: string | null; user: string };
type Store = { read(): Set<string>; add(key: string): void };

/** Only awards this recent on the live clock are celebrated, checked on every pass. */
export const CELEBRATION_WINDOW_MS = 10 * 60_000;
const STORAGE_KEY = 'chugalug.celebratedSpikes';
const KEEP_MS = 2 * 86_400_000;

export const celebrationKey = (scope: CelebrationScope, event: SpikeEvent): string =>
  `${scope.itinerary}:${scope.date}:${scope.runId ?? ''}:${scope.user}:${event.id}`;
const scopeId = (s: CelebrationScope) => `${s.itinerary}:${s.date}:${s.runId ?? ''}:${s.user}`;
const oldestFirst = (a: SpikeEvent, b: SpikeEvent) =>
  Date.parse(a.at) - Date.parse(b.at) || a.order - b.order || a.id.localeCompare(b.id);

export class CelebrationQueue {
  private current: SpikeEvent | null = null;
  private scope: string | null = null;
  /** The store's marks, read once per scope (not on every clock tick) and kept up to date by `shown`. */
  private marked: Set<string> | null = null;
  /** The head last checked against a fresh read of the store. */
  private checked: string | null = null;
  constructor(private deps: { now: () => Date; store: Store }) {}

  /** Recompute from the current timeline; returns the event to show now, or null. */
  next(events: SpikeEvent[], scope: CelebrationScope | null, quiet: boolean): SpikeEvent | null {
    if (!scope || quiet) { this.reset(); return null; }
    if (this.scope !== scopeId(scope)) { this.reset(); this.scope = scopeId(scope); }
    // Already started (and marked): it plays out, even if the feed is reloading or it was undone.
    if (this.current) return this.current;
    const since = this.deps.now().getTime() - CELEBRATION_WINDOW_MS;
    const fresh = this.marked === null;
    this.marked ??= this.deps.store.read();
    const pending = () => events
      .filter((e) => e.user === scope.user && Date.parse(e.at) >= since && !this.marked!.has(celebrationKey(scope, e)))
      .sort(oldestFirst)[0] ?? null;
    let head = pending();
    // Another tab may have celebrated it since these marks were read: one more read for each new head.
    if (head && !fresh && head.id !== this.checked) { this.marked = this.deps.store.read(); head = pending(); }
    this.checked = head?.id ?? null;
    return head;
  }

  /** The overlay started showing this event: mark it. */
  shown(event: SpikeEvent, scope: CelebrationScope): void {
    const key = celebrationKey(scope, event);
    this.deps.store.add(key);
    if (this.scope !== scopeId(scope)) { this.marked = null; this.scope = scopeId(scope); }
    this.marked?.add(key);
    this.current = event;
  }

  /** The overlay finished or was dismissed: the next one may go. */
  done(): void { this.current = null; }

  reset(): void { this.current = null; this.scope = null; this.marked = null; this.checked = null; }
}

/** `{key: marked at}` in localStorage, pruned on write; always mirrored in memory for the session. */
export function celebrationStore(now: () => number = Date.now): Store {
  const memory = new Set<string>();
  const load = (): Record<string, number> => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, number] => typeof e[1] === 'number'));
    } catch {
      return {};
    }
  };
  return {
    read: () => new Set([...memory, ...Object.keys(load())]),
    add(key) {
      memory.add(key);
      try {
        const t = now();
        const kept = Object.fromEntries(Object.entries(load()).filter(([, marked]) => t - marked <= KEEP_MS));
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...kept, [key]: t }));
      } catch {
        // Blocked storage: the memory set still keeps it for this session.
      }
    }
  };
}
