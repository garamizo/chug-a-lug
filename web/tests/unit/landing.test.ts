import { describe, expect, it } from 'vitest';
import { Landing } from '../../src/lib/landing';

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
});
