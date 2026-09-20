import { describe, expect, it, vi } from 'vitest';
import { createRealtimeLoader } from '../../src/lib/server/metra/realtime';
import { encodeFeed, tripUpdate } from '../fixtures/rt';

const bytes = (ts: number) => encodeFeed([tripUpdate({ id: 'e1', tripId: 'T1' })], ts);

/**
 * A tight ArrayBuffer copy. protobufjs's `finish()` returns a Node Buffer backed by an 8 KB pool,
 * and `Buffer.prototype.slice` is subarray semantics, so `.buffer` would hand back the whole pool
 * and the decoder would read past the message.
 */
const toArrayBuffer = (u8: Uint8Array): ArrayBuffer => new Uint8Array(u8).buffer;

/** A fetch that answers every feed with the same bytes and counts calls. */
function stubFetch(body: Uint8Array, ok = true) {
  const calls: { url: string; auth: string | null }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
    return ok
      ? { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(body) }
      : { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** A fetch that fails only the named feeds, so one feed can rot while the others stay healthy. */
function stubFailing(body: Uint8Array, failing: string[]) {
  return (async (url: string) => {
    if (failing.some((f) => String(url).endsWith(`/${f}`))) {
      return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(body) };
  }) as unknown as typeof fetch;
}

describe('createRealtimeLoader', () => {
  it('is disabled without a token and never fetches', async () => {
    const { impl, calls } = stubFetch(bytes(1));
    const rt = createRealtimeLoader({ base: 'https://x.test', token: '', fetchImpl: impl });
    await rt.refresh();
    expect(calls).toHaveLength(0);
    expect(rt.status()).toMatchObject({ fetchedAt: null, ageSec: null, enabled: false });
    expect(rt.statusOf('tripupdates')).toEqual({ fetchedAt: null, ageSec: null, enabled: false });
    expect(rt.feeds().tripupdates).toBeNull();
    rt.stop();
  });

  it('fetches all three feeds with a bearer token and decodes them', async () => {
    const { impl, calls } = stubFetch(bytes(1700000000));
    const rt = createRealtimeLoader({ base: 'https://x.test', token: 'SECRET', fetchImpl: impl });
    await rt.refresh();
    expect(calls.map((c) => c.url).sort()).toEqual([
      'https://x.test/alerts', 'https://x.test/positions', 'https://x.test/tripupdates'
    ]);
    expect(calls.every((c) => c.auth === 'Bearer SECRET')).toBe(true);
    expect(rt.feeds().tripupdates?.message.entity[0].id).toBe('e1');
    expect(rt.status().enabled).toBe(true);
    rt.stop();
  });

  it('keeps the last good feed when a fetch fails', async () => {
    const good = stubFetch(bytes(1700000000));
    const rt = createRealtimeLoader({ base: 'https://x.test', token: 'S', fetchImpl: good.impl });
    await rt.refresh();
    const first = rt.feeds().tripupdates;
    const bad = stubFetch(new Uint8Array(0), false);
    rt.setFetch(bad.impl);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await rt.refresh();
    expect(rt.feeds().tripupdates).toBe(first);
    rt.stop();
  });

  it('reports the age of the newest successful fetch', async () => {
    const { impl } = stubFetch(bytes(1700000000));
    const rt = createRealtimeLoader({ base: 'https://x.test', token: 'S', fetchImpl: impl, now: () => new Date('2026-12-26T20:02:00Z') });
    await rt.refresh({ at: new Date('2026-12-26T20:00:00Z') });
    expect(rt.status().ageSec).toBe(120);
    rt.stop();
  });

  it('ages each feed on its own, so a healthy feed cannot vouch for a broken one', async () => {
    let clock = new Date('2026-12-26T20:00:00Z');
    const body = bytes(1700000000);
    const { impl } = stubFetch(body);
    const rt = createRealtimeLoader({ base: 'https://x.test', token: 'S', fetchImpl: impl, now: () => clock });
    // Everything healthy at 20:00.
    await rt.refresh({ at: new Date('2026-12-26T20:00:00Z') });
    expect(rt.statusOf('tripupdates').ageSec).toBe(0);

    // tripupdates starts failing; alerts and positions keep succeeding for another ten minutes.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    rt.setFetch(stubFailing(body, ['tripupdates']));
    clock = new Date('2026-12-26T20:10:00Z');
    await rt.refresh({ at: clock });

    expect(rt.statusOf('alerts').ageSec).toBe(0);
    expect(rt.statusOf('tripupdates').ageSec).toBe(600);
    // The retained message is still there — it is the freshness that must give it away.
    expect(rt.feeds().tripupdates).not.toBeNull();
    // The overall figure follows the newest feed, which is why callers must not use it for predictions.
    expect(rt.status().ageSec).toBe(0);
    rt.stop();
  });
});
