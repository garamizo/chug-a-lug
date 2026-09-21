import { copy } from '$lib/labels';
import { eventTimeAt, readClockCommand, readClockState, transitionClock, type ClockState } from '$lib/sim/clock';

export type ClockContext = { enabled: false; eventNow: string; serverWallNow: string }
  | (ClockState & { enabled: true; eventNow: string; serverWallNow: string; ended: boolean });
type ClockErrorKey = 'simDisabled' | 'simUnavailable' | 'simInvalidControl' | 'simClockConflict' | 'simClockBusy';
export class ClockServiceError extends Error {
  constructor(public status: 400 | 404 | 409 | 503, key: ClockErrorKey, public current?: ClockContext) {
    super(copy[key]);
  }
}
export type ClockConfig = {
  enabled: () => boolean;
  runId: () => string;
  read: () => Promise<unknown>;
  write: (state: ClockState) => Promise<void>;
  now?: () => Date;
};

/** One authority per web process; callbacks never execute while holding the admission lock. */
export function createClockService(config: ClockConfig) {
  const now = config.now ?? (() => new Date());
  let queue: Promise<unknown> = Promise.resolve();
  let writers = 0;
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const pending = queue.then(operation);
    queue = pending.then(() => undefined, () => undefined);
    return pending;
  }
  async function state(): Promise<ClockState> {
    try {
      const value = readClockState(await config.read());
      if (value.runId !== config.runId()) throw new Error();
      return value;
    } catch { throw new ClockServiceError(503, 'simUnavailable'); }
  }
  function context(value: ClockState, at = now()): ClockContext {
    const eventNow = eventTimeAt(value, at).toISOString();
    const ended = eventNow === value.windowEnd;
    return Object.freeze({ ...value, rate: ended ? 0 : value.rate,
      enabled: true as const, eventNow, serverWallNow: at.toISOString(), ended });
  }
  async function readContext(): Promise<ClockContext> {
    if (!config.enabled()) {
      const at = now().toISOString();
      return Object.freeze({ enabled: false, eventNow: at, serverWallNow: at });
    }
    return context(await state());
  }
  async function change(expectedRevision: unknown, command: unknown): Promise<ClockContext> {
    if (!config.enabled()) throw new ClockServiceError(404, 'simDisabled');
    let parsed;
    try { parsed = readClockCommand(command); }
    catch { throw new ClockServiceError(400, 'simInvalidControl'); }
    return exclusive(async () => {
      const value = await state(), at = now();
      const current = context(value, at);
      if (expectedRevision !== value.revision) throw new ClockServiceError(409, 'simClockConflict', current);
      if (writers > 0) throw new ClockServiceError(409, 'simClockBusy', current);
      let next;
      try { next = transitionClock(value, parsed, at); }
      catch { throw new ClockServiceError(400, 'simInvalidControl'); }
      try { await config.write(next); }
      catch { throw new ClockServiceError(503, 'simUnavailable'); }
      return context(next);
    });
  }
  async function withEventWrite<T>(expectedRevision: number | undefined, publish: (captured: ClockContext) => Promise<T>): Promise<T> {
    if (!config.enabled()) return publish(await readContext());
    const captured = await exclusive(async () => {
      const value = await state();
      const current = context(value);
      if (expectedRevision !== undefined && expectedRevision !== value.revision) {
        throw new ClockServiceError(409, 'simClockConflict', current);
      }
      writers++;
      return current;
    });
    try { return await publish(captured); }
    finally { writers--; }
  }
  return { readContext, change, withEventWrite };
}
