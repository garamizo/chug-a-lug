import { describe, expect, it } from 'vitest';
import { createSends } from '../../src/lib/sends';

function deferred<T = void>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('sends', () => {
  it('counts a send until it settles', async () => {
    const s = createSends();
    const d = deferred();
    expect(s.sending()).toBe(false);
    const t = s.track(d.promise);
    expect(s.sending()).toBe(true);
    d.resolve();
    await t;
    expect(s.sending()).toBe(false);
  });
  it('a rejected send still uncounts', async () => {
    const s = createSends();
    const t = s.track(Promise.reject(new Error('boom')));
    await expect(t).rejects.toThrow('boom');
    expect(s.sending()).toBe(false);
  });
  it('two sends count separately', async () => {
    const s = createSends();
    const a = deferred(), b = deferred();
    const ta = s.track(a.promise), tb = s.track(b.promise);
    a.resolve();
    await ta;
    expect(s.sending()).toBe(true);
    b.resolve();
    await tb;
    expect(s.sending()).toBe(false);
  });
});
