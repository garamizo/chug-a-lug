import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pb, subscribe } from '../../src/lib/pb';

/** Just enough EventSource for the SDK: named listeners, and a way to deliver a message. */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  constructor(public url: string) { FakeEventSource.last = this; }
  addEventListener(name: string, fn: (e: MessageEvent) => void) { (this.listeners.get(name) ?? this.listeners.set(name, new Set()).get(name)!).add(fn); }
  removeEventListener(name: string, fn: (e: MessageEvent) => void) { this.listeners.get(name)?.delete(fn); }
  close() {}
  /** Delivers to `name`, or to every subscription of that topic (the SDK appends its options to the name). */
  emit(name: string, data: unknown, lastEventId = '') {
    for (const [key, fns] of this.listeners) {
      if (key !== name && !key.startsWith(`${name}?`)) continue;
      for (const fn of [...fns]) fn({ data: JSON.stringify(data), lastEventId } as MessageEvent);
    }
  }
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => (resolve = r)); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

beforeEach(() => { vi.stubGlobal('EventSource', FakeEventSource); });
afterEach(() => { (pb.realtime as unknown as { disconnect(): void }).disconnect(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('a second subscriber to a topic already sent while the connection is still opening hears its events', async () => {
  // The SDK reports "not connected" until its first subscription POST answers. A listener added to an
  // already-sent topic in that window was never attached to the event stream (the Crew Board, opened
  // while Live's feed subscribed the same collections, then missed every update).
  const posted = deferred();
  vi.spyOn(pb, 'send').mockImplementation(async () => { await posted.promise; return {}; });
  const live = vi.fn(), board = vi.fn(), ready = vi.fn();
  const stops = [subscribe('users', '', live)];
  await settle();
  FakeEventSource.last!.emit('PB_CONNECT', { clientId: 'c1' }, 'c1');
  await settle();
  stops.push(subscribe('users', '', board, ready));
  await settle();
  posted.resolve();
  await settle();
  expect(ready).toHaveBeenCalledOnce();
  FakeEventSource.last!.emit('users/*', { action: 'create', record: { id: 'u1' } });
  expect(live).toHaveBeenCalledOnce();
  expect(board).toHaveBeenCalledOnce();
  stops.forEach((stop) => stop());
});
