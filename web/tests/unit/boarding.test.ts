import { describe, expect, it } from 'vitest';
import { BOARDING_KEY, clearBoarding, loadBoarding, saveBoarding, stepFor } from '../../src/lib/boarding';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const b = { requestId: 'r', secret: 's', name: 'Bob', email: 'bob@example.com', savedAt: 1_000 };

describe('stored boarding requests', () => {
  it('round-trips and resumes within 72 h', () => {
    const s = mem(); saveBoarding(s, b);
    expect(loadBoarding(s, 1_000 + 71 * 3600e3)).toEqual(b);
  });
  it('forgets after 72 h and on clear', () => {
    const s = mem(); saveBoarding(s, b);
    expect(loadBoarding(s, 1_000 + 73 * 3600e3)).toBeNull();
    saveBoarding(s, b); clearBoarding(s);
    expect(s.getItem(BOARDING_KEY)).toBeNull();
  });
  it('survives garbage', () => { const s = mem(); s.setItem(BOARDING_KEY, '{nope'); expect(loadBoarding(s, 0)).toBeNull(); });
  it('maps server status to a step, an expired resume included', () => {
    expect(stepFor('unverified')).toBe('code');
    expect(stepFor('waiting')).toBe('waiting');
    expect(stepFor('aboard')).toBe('aboard');
    expect(stepFor('turned_away')).toBe('turned_away');
    expect(stepFor('expired')).toBe('expired');
    expect(stepFor('anything else')).toBe('expired');
  });
});
