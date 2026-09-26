import { describe, expect, it } from 'vitest';
import { canDelete, canEditSettings, canEditStops } from '../../src/lib/permissions';

const builder = { id: 'b' }, other = { id: 'o' }, boss = { id: 'c', is_admin: true };
const draft = { status: 'draft' as const, created_by: 'b' };
const locked = { status: 'locked' as const, created_by: 'b' };
const archived = { status: 'archived' as const, created_by: 'b' };

describe('permissions', () => {
  it('the builder edits and deletes only their draft', () => {
    expect(canEditStops(draft, builder)).toBe(true);
    expect(canEditSettings(draft, builder)).toBe(true);
    expect(canDelete(draft, builder)).toBe(true);
    for (const it of [locked, archived]) {
      expect(canEditStops(it, builder)).toBe(false);
      expect(canDelete(it, builder)).toBe(false);
    }
  });
  it('other crew can do nothing, signed out even less', () => {
    for (const it of [draft, locked, archived]) {
      for (const who of [other, null, undefined]) {
        expect(canEditStops(it, who)).toBe(false);
        expect(canEditSettings(it, who)).toBe(false);
        expect(canDelete(it, who)).toBe(false);
      }
    }
  });
  it('the Conductor edits and deletes every route', () => {
    for (const it of [draft, locked, archived]) {
      expect(canEditStops(it, boss)).toBe(true);
      expect(canDelete(it, boss)).toBe(true);
    }
  });
});
