import { expect, it } from 'vitest';
import { buildAuthUrl, readReturn } from '../../src/lib/google';
const stored = { mode: 'join' as const, name: 'Bob', state: 'abc', codeVerifier: 'v', redirectUrl: 'https://chugalug.app/auth/google' };
it('appends the redirect uri PocketBase leaves open', () =>
  expect(buildAuthUrl('https://accounts.google.com/o?x=1&redirect_uri=', stored.redirectUrl)).toBe('https://accounts.google.com/o?x=1&redirect_uri=https%3A%2F%2Fchugalug.app%2Fauth%2Fgoogle'));
it('accepts only a matching state with a code', () => {
  expect(readReturn(new URL('https://x/auth/google?state=abc&code=c1'), stored)).toEqual({ ok: true, code: 'c1' });
  expect(readReturn(new URL('https://x/auth/google?state=evil&code=c1'), stored)).toEqual({ ok: false });
  expect(readReturn(new URL('https://x/auth/google?state=abc'), stored)).toEqual({ ok: false });
  expect(readReturn(new URL('https://x/auth/google?state=abc&code=c1'), null)).toEqual({ ok: false });
});
