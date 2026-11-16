import { describe, expect, it } from 'vitest';
import { clearSignup, loadSignup, saveSignup, tokenFromHash, type StoredSignup } from '../../src/lib/signup';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const T = 'a'.repeat(32);

describe('tokenFromHash', () => {
  it('takes the 32 characters and ignores trailing punctuation from a chat app', () => expect(tokenFromHash('#' + T + ').')).toBe(T));
  it.each(['#short', '', '#' + '!'.repeat(32), '#' + 'a'.repeat(31)])('%j is no token', (h) => expect(tokenFromHash(h)).toBeNull());
});

describe('stored sign-up', () => {
  const s: StoredSignup = { token: T, signupId: 'x', secret: 'y', name: 'Al', email: 'a@b.co', codeSent: true, savedAt: 1000 };
  it('round-trips', () => { const m = mem(); saveSignup(m, s); expect(loadSignup(m, 2000)).toEqual(s); });
  it('is gone after 60 minutes', () => { const m = mem(); saveSignup(m, s); expect(loadSignup(m, 1000 + 60 * 60e3 - 1)).toEqual(s); expect(loadSignup(m, 1000 + 60 * 60e3)).toBeNull(); });
  it('is null for corrupt JSON and after clear', () => {
    const m = mem(); m.setItem('chugalug_signup', '{nope'); expect(loadSignup(m, 5)).toBeNull();
    saveSignup(m, s); clearSignup(m); expect(loadSignup(m, 2000)).toBeNull();
  });
  it('never throws when storage does', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(() => { saveSignup(bad, s); clearSignup(bad); }).not.toThrow(); expect(loadSignup(bad, 5)).toBeNull();
  });
});
