import { expect, it } from 'vitest';
import { buildAuthUrl, readReturn, GOOGLE_RETRY_KEY, loadGoogleRetry, saveGoogleRetry } from '../../src/lib/google';
const stored = { mode: 'join' as const, name: 'Bob', state: 'abc', codeVerifier: 'v', redirectUrl: 'https://chugalug.app/auth/google' };
it('appends the redirect uri PocketBase leaves open', () =>
  expect(buildAuthUrl('https://accounts.google.com/o?x=1&redirect_uri=', stored.redirectUrl)).toBe('https://accounts.google.com/o?x=1&redirect_uri=https%3A%2F%2Fchugalug.app%2Fauth%2Fgoogle'));
it('accepts only a matching state with a code', () => {
  expect(readReturn(new URL('https://x/auth/google?state=abc&code=c1'), stored)).toEqual({ ok: true, code: 'c1' });
  expect(readReturn(new URL('https://x/auth/google?state=evil&code=c1'), stored)).toEqual({ ok: false });
  expect(readReturn(new URL('https://x/auth/google?state=abc'), stored)).toEqual({ ok: false });
  expect(readReturn(new URL('https://x/auth/google?state=abc&code=c1'), null)).toEqual({ ok: false });
});

it('retry hints contain only short-lived intent and cannot authorize a callback', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  saveGoogleRetry(storage, stored, 1000);
  expect(JSON.parse(values.get(GOOGLE_RETRY_KEY)!)).toEqual({ mode: 'join', name: 'Bob', savedAt: 1000 });
  expect(loadGoogleRetry(storage, 1001)).toEqual({ mode: 'join', name: 'Bob' });
  expect(loadGoogleRetry(storage, 1000 + 30 * 60e3)).toBeNull();
  expect(loadGoogleRetry(storage, 999)).toBeNull();
  for (const value of ['oops', '{}', '{"mode":"admin","name":"Bob","savedAt":1000}']) {
    values.set(GOOGLE_RETRY_KEY, value);
    expect(loadGoogleRetry(storage, 1001)).toBeNull();
  }
});
