import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { labels, label, copy, proofCaption, accessEventLabels, signInMethodLabels } from '../../src/lib/labels';

describe('labels', () => {
  it('names the Crew Board and its Bulletin statuses', () => {
    expect(labels.userRoster).toBe('Crew Board');
    expect(copy.seenBulletin).toBe('Seen');
    expect(copy.unseenBulletin).toBe('Not seen');
  });
  it('carries the Metra credit', () => {
    expect(copy.notAffiliated).toBe('Schedule from Metra’s public feed. Not affiliated with Metra.');
    expect(copy.timetablePublished).toBe('Timetable published');
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
  it('names the Golden Spikes', () => {
    expect(copy).toMatchObject({
      spikeAuthor: 'Golden Spike', spikePathfinder: 'Pathfinder', spikeBigBoy: 'Big Boy', spikeCaboose: 'Caboose',
      spikeTriple: 'Triple Header', spikeFullConsist: 'Full Consist', spikeWhistleStop: 'Whistle Stop', spikeRailfan: 'Railfan',
      spikePathfinderWhy: 'First to log it today', spikeBigBoyWhy: 'Most drinks', spikeCabooseWhy: 'Fewest drinks',
      spikeTripleWhy: 'Three drinks at one station', spikeFullConsistWhy: 'One of each', spikeWhistleStopWhy: 'Most messages',
      spikeRailfanWhy: 'Most photos', spikeFirst: 'first', spikeTakesFrom: 'takes it from', spikeLaurel: 'Golden Spikes', spikeTimes: '×'
    });
  });
  it('names the run home', () => {
    expect(copy.runHome).toBe('Run home to');
    expect(copy.runHomeMidnight).toBe('The last train home must arrive before midnight.');
    expect(copy).not.toHaveProperty('boardAtPick');
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
  it('names every stored sign-in method and access-log event the Manifest shows', () => {
    const migration = readFileSync('../pocketbase/pb_migrations/1758900000_crew_access.js', 'utf8');
    const values = (field: string, after = 0) => {
      const at = migration.indexOf(`name: '${field}', type: 'select'`, after);
      return JSON.parse(/values: (\[[^\]]*\])/.exec(migration.slice(at))![1].replace(/'/g, '"')) as string[];
    };
    const log = migration.indexOf("name: 'access_log'");
    for (const [map, field, after] of [[signInMethodLabels, 'method', log], [accessEventLabels, 'event', log]] as const) {
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
  it('has copy for password sign-in and reset', () => {
    for (const k of ['passwordMismatch', 'passwordMissing', 'forgotPassword', 'forgotTitle', 'forgotIntro',
      'emailMeLink', 'linkMaybeSent', 'backToSignIn', 'resetTitle', 'setPassword', 'passwordSetSignIn', 'resetLinkDead', 'askNewLink']) {
      expect((copy as Record<string, string>)[k], k).toBeTruthy();
    }
    expect(copy.loginIntro).toBe('Sign in to catch up with the crew.');
  });
  it('has the photo Tab copy and captions', () => {
    expect(copy.tabProofHint).toBe('Snap it to count it.');
    expect(copy.tabSending).toBe('Sending…');
    expect(copy.tabRetry).toBe('Retry');
    expect(copy.proofNeedsImage).toBe('Take a photo — a video does not count.');
    expect(copy.proofNeedsStop).toBe('Drinks count at a stop on today’s route.');
    expect(proofCaption('beer', 'Ana')).toBe('🍺 Beer · Ana');
    expect(proofCaption('', 'Ana')).toBe('Ana');
    expect(proofCaption(undefined, 'Ana')).toBe('Ana');
  });
  it('has the Closing Time copy', () => {
    expect(copy.closingCard).toBe('Closing Time — the night’s highlights');
    expect(copy.closingPlay).toBe('Play');
    expect(copy.closingNotYet).toBe('Closing Time starts when the train home arrives.');
    expect(copy.closingLoading).toBe('Putting the night together…');
    expect(copy.closingReplay).toBe('Watch again');
    expect(copy.closingDone).toBe('Done');
    expect(copy.closingFinale).toBe('That’s the night');
    expect(copy.closingCrewTotal).toBe('drinks, all told');
    expect(copy.closingCheers).toBe('Cheers');
    expect(copy.closingRetry).toBe('Try again');
  });
});
