import { describe, expect, it } from 'vitest';
import { buildSimConfig, assertSameRun, composeEnvironment } from '../../src/lib/sim/config';

const scenario = {
  serviceDate: '2026-12-26', startTime: '10:00', epochStart: '2026-12-26T16:00:00Z',
  windowStart: '2026-12-26T16:00:00Z', windowEnd: '2026-12-27T05:00:00Z'
};
const input = { run: 'practice-1', source: 'fixture', root: '/checkout', scenario, fixtureHash: 'a'.repeat(64) };
const credentials = { PB_ADMIN_EMAIL: 'sim@chugalug.invalid', PB_ADMIN_PASSWORD: 'a'.repeat(48),
  CREW_PASSWORD: 'b'.repeat(48), ADMIN_PASSWORD: 'c'.repeat(48), INTERNAL_SECRET: 'd'.repeat(48) };

describe('isolated rehearsal configuration', () => {
  it('derives isolated storage, project, ports, and explicit timetable bounds', () => {
    expect(buildSimConfig(input)).toMatchObject({ run: 'practice-1', source: 'fixture',
      runDir: '/checkout/.simulations/practice-1', webPort: 15174, pbPort: 18094,
      bindHost: '127.0.0.1', webOrigin: 'http://127.0.0.1:15174', pbOrigin: 'http://127.0.0.1:18094',
      scenario: { serviceDate: '2026-12-26', epochStart: '2026-12-26T16:00:00.000Z' } });
  });
  it.each(['', '../live', '/tmp/run', 'Main', '-run', 'a'.repeat(41), 'a b', 'a\n'])('rejects unsafe run %j', run => {
    expect(() => buildSimConfig({ ...input, run })).toThrow();
  });
  it.each(['../recording', '', 'some-recording'])('refuses unavailable sources instead of silently using the fixture: %s', source => {
    expect(() => buildSimConfig({ ...input, source })).toThrow();
  });
  it.each(['3000', '8090', '15173', '18093', '18090', '18095', '0', '65536', '1.5', '18094'])('rejects reserved, invalid or colliding web port %s', WEB_PORT => {
    expect(() => buildSimConfig({ ...input, settings: { WEB_PORT } })).toThrow();
  });
  it.each(['PB_URL', 'PB_ADMIN_PASSWORD', 'DATA_DIR', 'GTFS_URL', 'COMPOSE_FILE', 'SIM_RUN_DIR'])('rejects unsafe configuration override %s', key => {
    expect(() => buildSimConfig({ ...input, settings: { [key]: 'production' } })).toThrow();
  });
  it.each([
    { WEB_ORIGIN: 'https://chugalug.app' }, { PB_ORIGIN: 'http://127.0.0.1:8090' },
    { WEB_ORIGIN: 'http://user:pass@127.0.0.1:15174' }, { WEB_ORIGIN: 'http://127.0.0.1:15174/path' },
    { BIND_HOST: '0.0.0.0' }, { BIND_HOST: 'example.com' }
  ])('rejects ambiguous exposure or unisolated origin %j', settings => {
    expect(() => buildSimConfig({ ...input, settings })).toThrow();
  });
  it('accepts deliberate LAN HTTP and dedicated HTTPS origins', () => {
    expect(buildSimConfig({ ...input, settings: { BIND_HOST: '0.0.0.0',
      WEB_ORIGIN: 'http://192.168.1.5:15174', PB_ORIGIN: 'http://192.168.1.5:18094' } }).bindHost).toBe('0.0.0.0');
    expect(buildSimConfig({ ...input, settings: { WEB_ORIGIN: 'https://rehearsal.example.test',
      PB_ORIGIN: 'https://rehearsal-pb.example.test' } }).webOrigin).toBe('https://rehearsal.example.test');
  });
  it.each([
    { serviceDate: '' }, { serviceDate: '2026-02-30' }, { epochStart: '2026-12-26T10:00:00' },
    { epochStart: '2026-12-25T16:00:00Z' }, { windowEnd: '2026-12-26T15:00:00Z' },
    { startTime: '24:00' }, { startTime: '11:00' }, { serviceDate: '2026-12-25' }
  ])('requires an explicit, consistent Chicago date/start and UTC window %j', patch => {
    expect(() => buildSimConfig({ ...input, scenario: { ...scenario, ...patch } })).toThrow();
  });
  it('refuses changed source/date/ports/fixtures when resuming a named run', () => {
    const config = buildSimConfig(input);
    expect(() => assertSameRun(config, structuredClone(config))).not.toThrow();
    for (const patch of [{ source: 'other' }, { pbPort: 18096 }, { fixtureHash: 'b'.repeat(64) },
      { scenario: { ...config.scenario, serviceDate: '2026-12-25' } }]) {
      expect(() => assertSameRun(config, { ...config, ...patch })).toThrow();
    }
  });
  it('starts a new run in a different directory/project', () => {
    const one = buildSimConfig(input), two = buildSimConfig({ ...input, run: 'practice-2' });
    expect(two.runDir).not.toBe(one.runDir);
    expect(two.project).not.toBe(one.project);
  });
  it('does not forward inherited production secrets or Compose overrides', () => {
    const environment = composeEnvironment(buildSimConfig(input), credentials, {
      PATH: '/usr/bin', HOME: '/home/test', PB_ADMIN_PASSWORD: 'production', METRA_API_TOKEN: 'production',
      GOOGLE_PLACES_KEY: 'production', COMPOSE_FILE: '/live/compose.yml', COMPOSE_PROJECT_NAME: 'live', NODE_OPTIONS: '--inspect'
    });
    expect(environment.PB_ADMIN_PASSWORD).toBe(credentials.PB_ADMIN_PASSWORD);
    expect(environment.METRA_API_TOKEN).toBeUndefined();
    expect(environment.GOOGLE_PLACES_KEY).toBeUndefined();
    expect(environment.COMPOSE_FILE).toBeUndefined();
    expect(environment.COMPOSE_PROJECT_NAME).toBeUndefined();
    expect(environment.NODE_OPTIONS).toBeUndefined();
    expect(environment.SIM_RUN_DIR).toBe('/checkout/.simulations/practice-1');
    expect(environment.PATH).toBe('/usr/bin');
  });
});
