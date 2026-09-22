// Pure setup validation. Paths and Compose environment are derived, never inherited from .env.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { utcInstant } from './clock.ts';
import { simSetup } from '../labels.ts';

export type ScenarioClock = { serviceDate: string; startTime: string; epochStart: string; windowStart: string; windowEnd: string };
export type SimConfig = {
  version: 1; run: string; source: string; root: string; runDir: string; project: string;
  webPort: number; pbPort: number; bindHost: string; webOrigin: string; pbOrigin: string;
  fixtureHash: string; scenario: ScenarioClock;
};
export type Credentials = Record<'PB_ADMIN_EMAIL' | 'PB_ADMIN_PASSWORD' | 'CREW_PASSWORD' | 'ADMIN_PASSWORD' | 'INTERNAL_SECRET', string>;
const invalid = (field: string): never => { throw new Error(simSetup.invalid(field)); };
export function runDirectory(root: string, run: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(run)) invalid('RUN');
  if (!root.startsWith('/') || resolve(root) !== root) invalid('root');
  return resolve(root, '.simulations', run);
}
export function buildSimConfig(input: {
  root: string; run: string; source: string; scenario: ScenarioClock; fixtureHash: string; settings?: Record<string, string | undefined>;
}): SimConfig {
  const runDir = runDirectory(input.root, input.run);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.source)) invalid('SOURCE');
  if (!/^[a-f0-9]{64}$/.test(input.fixtureHash)) invalid('fixtureHash');
  const settings = input.settings ?? {};
  for (const key of Object.keys(settings)) {
    if (!['WEB_PORT', 'PB_PORT', 'BIND_HOST', 'WEB_ORIGIN', 'PB_ORIGIN'].includes(key)) invalid(key);
  }
  function port(key: string, fallback: number) {
    const text = settings[key] ?? String(fallback), value = Number(text);
    if (!/^\d+$/.test(text) || value < 1024 || value > 65535 || [3000, 8090, 15173, 18093, 18090, 18095].includes(value)) invalid(key);
    return value;
  }
  const webPort = port('WEB_PORT', 15174), pbPort = port('PB_PORT', 18094);
  if (webPort === pbPort) invalid('ports');
  const bindHost = settings.BIND_HOST ?? '127.0.0.1';
  if (isIP(bindHost) !== 4) invalid('BIND_HOST');
  if (bindHost !== '127.0.0.1' && (!settings.WEB_ORIGIN || !settings.PB_ORIGIN)) invalid('phone origins');
  function origin(key: string, port: number) {
    const text = settings[key] ?? `http://127.0.0.1:${port}`;
    let url;
    try { url = new URL(text); } catch { return invalid(key); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) invalid(key);
    // Default production domains and reserved host ports must never become a rehearsal origin.
    if (url.hostname === 'chugalug.app' || url.hostname.endsWith('.chugalug.app') || ['3000', '8090', '15173', '18093', '18090', '18095'].includes(url.port)) invalid(key);
    if (url.protocol === 'http:' && Number(url.port) !== port) invalid(key);
    return url.origin;
  }
  const webOrigin = origin('WEB_ORIGIN', webPort), pbOrigin = origin('PB_ORIGIN', pbPort);
  if (webOrigin === pbOrigin) invalid('origins');
  const s = input.scenario;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.serviceDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.startTime)) invalid('scenario date/time');
  utcInstant(`${s.serviceDate}T00:00:00Z`);
  const epochStart = utcInstant(s.epochStart), windowStart = utcInstant(s.windowStart), windowEnd = utcInstant(s.windowEnd);
  if (windowStart >= windowEnd || epochStart < windowStart || epochStart >= windowEnd) invalid('scenario window');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epochStart));
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  if (`${part('year')}-${part('month')}-${part('day')}` !== s.serviceDate || `${part('hour')}:${part('minute')}` !== s.startTime) invalid('scenario Chicago start');
  return { version: 1, run: input.run, source: input.source, root: input.root, runDir,
    project: `chugalug-sim-${createHash('sha256').update(input.root).digest('hex').slice(0, 10)}-${input.run}`,
    webPort, pbPort, bindHost, webOrigin, pbOrigin, fixtureHash: input.fixtureHash,
    scenario: { serviceDate: s.serviceDate, startTime: s.startTime, epochStart, windowStart, windowEnd } };
}
export function assertSameRun(expected: SimConfig, saved: unknown): void {
  if (!saved || typeof saved !== 'object') invalid('run marker');
  const canonical = (obj: unknown): string => JSON.stringify(obj, Object.keys(expected).concat(Object.keys(expected.scenario)).sort());
  if (canonical(expected) !== canonical(saved)) throw new Error(simSetup.runMismatch);
}
export function composeEnvironment(config: SimConfig, credentials: Credentials, inherited: NodeJS.ProcessEnv): Record<string, string> {
  return {
    PATH: inherited.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: inherited.HOME ?? '/tmp',
    ...credentials, SIM_RUN_ID: config.run, SIM_RUN_DIR: config.runDir,
    SIM_WEB_PORT: String(config.webPort), SIM_PB_PORT: String(config.pbPort), SIM_BIND_HOST: config.bindHost,
    SIM_WEB_ORIGIN: config.webOrigin, SIM_PB_ORIGIN: config.pbOrigin
  };
}
