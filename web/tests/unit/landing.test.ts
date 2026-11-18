import { describe, expect, it } from 'vitest';
import { Landing } from '../../src/lib/landing';

// A Map-backed stand-in for sessionStorage.
function fakeStore() {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
  };
}

const throwingStore = {
  getItem: (): string | null => { throw new Error('denied'); },
  setItem: (): void => { throw new Error('denied'); },
};

describe('landing', () => {
  it('is the entry page until the app navigates', () => {
    const l = new Landing();
    expect(l.isEntry).toBe(true);
    l.noteNavigation(null);
    expect(l.isEntry).toBe(true);
    l.noteNavigation('/live');
    expect(l.isEntry).toBe(false);
  });
  it('still counts arriving from the login screen as opening the app', () => {
    const l = new Landing();
    l.noteNavigation('/login');
    expect(l.isEntry).toBe(true);
  });

  describe('across a full load', () => {
    it('a full load after moving is not an entry', () => {
      const s = fakeStore();
      const a = new Landing();
      a.noteNavigation('/route');
      a.persist(s);
      const b = new Landing();
      b.restore(s, 'navigate');
      expect(b.isEntry).toBe(false);
    });
    it('leaving login still persists an entry', () => {
      const s = fakeStore();
      const a = new Landing();
      a.noteNavigation('/login');
      a.persist(s);
      const b = new Landing();
      b.restore(s, 'navigate');
      expect(b.isEntry).toBe(true);
    });
    it("the person's own reload is an entry again", () => {
      const s = fakeStore();
      const a = new Landing();
      a.noteNavigation('/route');
      a.persist(s);
      const b = new Landing();
      b.restore(s, 'reload');
      expect(b.isEntry).toBe(true);
    });
    it('Back to a rebuilt page keeps the stored state', () => {
      const s = fakeStore();
      const a = new Landing();
      a.noteNavigation('/route');
      a.persist(s);
      const b = new Landing();
      b.restore(s, 'back_forward');
      expect(b.isEntry).toBe(false);
      expect(s.map.has('chugalug:landing-moved')).toBe(true);
    });
    it('empty storage is an entry', () => {
      const b = new Landing();
      b.restore(fakeStore(), 'navigate');
      expect(b.isEntry).toBe(true);
    });
    it('a throwing storage changes nothing', () => {
      const a = new Landing();
      a.noteNavigation('/route');
      expect(() => a.persist(throwingStore)).not.toThrow();
      const b = new Landing();
      expect(() => b.restore(throwingStore, 'navigate')).not.toThrow();
      expect(b.isEntry).toBe(true);
    });
    it('null storage changes nothing', () => {
      const a = new Landing();
      a.noteNavigation('/route');
      expect(() => a.persist(null)).not.toThrow();
      const b = new Landing();
      expect(() => b.restore(null, 'navigate')).not.toThrow();
      expect(b.isEntry).toBe(true);
    });
  });
});
