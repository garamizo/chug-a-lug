import { env } from '$env/dynamic/public';
import { pb } from '$lib/pb';
import { copy } from '$lib/labels';
import { readClockState, type ClockCommand, type ClockState } from './clock';
export type ClockSample = ClockState & { enabled: true; eventNow: string; serverWallNow: string; ended: boolean };
export class ClientClock {
  sample = $state<ClockSample | null>(null);
  synchronized = $state(false);
  lastSynced = $state<number | null>(null);
  private receipt = 0;
  private base = 0;
  private latestStart = -Infinity;
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(public enabled = false, private monotonic = () => performance.now()) {}
  revision = $derived(this.sample?.revision);
  runId = $derived(this.sample?.runId);
  eventNow(): Date | null {
    if (!this.enabled) return new Date();
    if (!this.sample) return null;
    return new Date(Math.min(Date.parse(this.sample.windowEnd), this.base + Math.max(0, this.monotonic() - this.receipt) * this.sample.rate));
  }
  accept(value: ClockSample, started: number, received: number): boolean {
    readClockState(value);
    if (!Number.isFinite(Date.parse(value.eventNow))) throw new Error(copy.simUnavailable);
    if (this.runId !== value.runId && started < this.latestStart) return false;
    if (this.sample?.runId === value.runId && (value.revision < this.sample.revision || (value.revision === this.sample.revision && started < this.latestStart))) return false;
    const changed = this.runId !== value.runId || this.revision !== value.revision;
    this.latestStart = started; this.receipt = received;
    this.base = Date.parse(value.eventNow) + Math.max(0, received - started) / 2 * value.rate;
    this.sample = value; this.synchronized = true; this.lastSynced = Date.now();
    if (changed) this.listeners.forEach(fn => fn());
    return true;
  }
  async sync(): Promise<void> {
    if (!this.enabled) return;
    const generation = this.generation, started = this.monotonic();
    try {
      const response = await fetch('/api/sim/clock', { cache: 'no-store', headers: { Authorization: pb.authStore.token }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(copy.simUnavailable);
      const value = await response.json();
      if (generation !== this.generation) return;
      if (!value.enabled) throw new Error(copy.simUnavailable);
      this.accept(value, started, this.monotonic());
    } catch (error) { if (generation === this.generation && started >= this.latestStart) this.synchronized = false; throw error; }
  }
  async ready() {
    if (!this.enabled) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.synchronized = false; throw new Error(copy.noSignal); }
    await this.sync();
    if (!this.synchronized) throw new Error(copy.simUnavailable);
  }
  async control(command: ClockCommand) {
    const expectedRevision = this.revision;
    await this.ready();
    if (expectedRevision !== undefined && expectedRevision !== this.revision) throw new Error(copy.simClockConflict);
    const started = this.monotonic(), generation = this.generation;
    const response = await fetch('/api/sim/clock', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(5000), headers: { Authorization: pb.authStore.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...command, expectedRevision: this.revision }) });
    const value = await response.json();
    if (generation !== this.generation) return;
    const current = response.ok ? value : value.clock;
    if (current?.enabled) this.accept(current, started, this.monotonic());
    if (!response.ok) throw new Error(value.message || copy.simClockConflict);
  }
  onRevision(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  reset() { this.generation++; this.sample = null; this.synchronized = false; this.lastSynced = null; this.latestStart = -Infinity; }
  private stopOwner: (() => void) | undefined;
  start(): () => void {
    this.stopOwner?.();
    const sync = () => { void this.sync().catch(() => {}); };
    const offline = () => { this.synchronized = false; };
    const timer = setInterval(sync, 5000);
    window.addEventListener('focus', sync); window.addEventListener('online', sync); window.addEventListener('offline', offline);
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true; clearInterval(timer);
      window.removeEventListener('focus', sync); window.removeEventListener('online', sync); window.removeEventListener('offline', offline);
      this.reset(); this.stopOwner = undefined;
    };
    this.stopOwner = stop;
    return stop;
  }
}
export const clientClock = new ClientClock(env.PUBLIC_SIM === '1');
