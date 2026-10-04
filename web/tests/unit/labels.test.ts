import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { labels, label, copy, accessEventLabels, requestStatusLabels, signInMethodLabels } from '../../src/lib/labels';

describe('labels', () => {
  it('names the Crew Board and its Bulletin statuses', () => {
    expect(labels.userRoster).toBe('Crew Board');
    expect(copy.seenBulletin).toBe('Seen');
    expect(copy.unseenBulletin).toBe('Not seen');
  });
  it('maps developer terms to the README glossary', () => {
    expect(label('planningPhase')).toBe('Route Planner');
    expect(label('lockedItinerary')).toBe('The Route');
    expect(label('livePhase')).toBe('Live');
    expect(label('wrapUpPhase')).toBe('Closing Time');
    expect(label('admin')).toBe('Conductor');
    expect(label('users')).toBe('Crew');
    expect(label('scoreboard')).toBe('Hall of Fame');
    expect(label('walk')).toBe('Walk');
  });
  it('has no empty labels', () => {
    for (const [k, v] of Object.entries(labels)) expect(v, k).not.toBe('');
  });
  it('has copy for every stop kind', () => {
    for (const k of ['kind_bar', 'kind_restaurant', 'kind_other']) {
      expect((copy as Record<string, string>)[k]).toBeTruthy();
    }
  });
  it('has copy for the new board, chat box and delete flows', () => {
    for (const k of ['ticketKicker', 'chipBoarding', 'chipCurrent', 'deleteRoute', 'deleteLockedConfirm', 'emojiTray', 'attachMedia', 'turnAround', 'statFinish']) {
      expect((copy as Record<string, string>)[k], k).toBeTruthy();
    }
  });
  it('names every stored boarding status, sign-in method and access-log event the Manifest shows', () => {
    const migration = readFileSync('../pocketbase/pb_migrations/1758900000_crew_access.js', 'utf8');
    const values = (field: string, after = 0) => {
      const at = migration.indexOf(`name: '${field}', type: 'select'`, after);
      return JSON.parse(/values: (\[[^\]]*\])/.exec(migration.slice(at))![1].replace(/'/g, '"')) as string[];
    };
    const log = migration.indexOf("name: 'access_log'");
    for (const [map, field, after] of [[requestStatusLabels, 'status', 0], [signInMethodLabels, 'method', log], [accessEventLabels, 'event', log]] as const) {
      const stored = values(field, after);
      expect(stored.length, field).toBeGreaterThan(2);
      for (const v of stored) expect(map[v], `${field}=${v}`).toBeTruthy();
    }
  });
  it('names the sign-in method and events the password migration adds', () => {
    const migration = readFileSync('../pocketbase/pb_migrations/1759000000_password_sign_in.js', 'utf8');
    const added = (field: string) => JSON.parse(new RegExp(`ADDED_${field.toUpperCase()} = (\\[[^\\]]*\\])`).exec(migration)![1].replace(/'/g, '"')) as string[];
    expect(added('event')).toEqual(['password_reset_sent', 'password_set']);
    expect(added('method')).toEqual(['password']);
    for (const v of added('event')) expect(accessEventLabels[v], v).toBeTruthy();
    for (const v of added('method')) expect(signInMethodLabels[v], v).toBeTruthy();
  });
});
