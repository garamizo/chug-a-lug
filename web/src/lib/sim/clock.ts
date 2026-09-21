// Event time only. Authentication, cache age and network timers continue using wall time.
export const CLOCK_RATES = [1, 5, 10, 30, 60] as const;
export type ClockState = {
  runId: string; revision: number; epochStart: string; wallStart: string;
  rate: number; resumeRate: number; serviceDate: string;
  source: 'recording' | 'timetable'; recordingId: string | null;
  windowStart: string; windowEnd: string;
};
export type ClockCommand =
  | { action: 'pause' | 'resume' }
  | { action: 'rate'; rate: number }
  | { action: 'seek'; at: string };

export class ClockValidationError extends Error {
  constructor() { super('invalid_clock'); }
}
const invalid = (): never => { throw new ClockValidationError(); };
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const slug = (value: unknown): string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : invalid();
const speed = (value: unknown): number =>
  typeof value === 'number' && (CLOCK_RATES as readonly number[]).includes(value) ? value : invalid();

/** Require explicit UTC, rejecting Date's silent normalization of impossible calendar dates. */
export function utcInstant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)) return invalid();
  return date.toISOString();
}

export function readClockState(value: unknown): ClockState {
  const row = object(value);
  const runId = slug(row.runId);
  const revision = row.revision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) return invalid();
  const epochStart = utcInstant(row.epochStart), wallStart = utcInstant(row.wallStart);
  const windowStart = utcInstant(row.windowStart), windowEnd = utcInstant(row.windowEnd);
  if (windowStart >= windowEnd || epochStart < windowStart || epochStart > windowEnd) return invalid();
  const rate = row.rate === 0 ? 0 : speed(row.rate), resumeRate = speed(row.resumeRate);
  if (typeof row.serviceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.serviceDate)) return invalid();
  utcInstant(`${row.serviceDate}T00:00:00Z`);
  const source = row.source;
  if (source !== 'recording' && source !== 'timetable') return invalid();
  const recordingId = source === 'recording' ? slug(row.recordingId) : null;
  if (source === 'timetable' && row.recordingId !== null) return invalid();
  return { runId, revision, epochStart, wallStart, rate, resumeRate, serviceDate: row.serviceDate,
    source, recordingId, windowStart, windowEnd };
}

export function eventTimeAt(state: ClockState, wallNow: Date): Date {
  const wallMs = wallNow.getTime();
  if (!Number.isFinite(wallMs)) return invalid();
  const start = Date.parse(state.epochStart), end = Date.parse(state.windowEnd);
  const elapsed = Math.max(0, wallMs - Date.parse(state.wallStart));
  return new Date(Math.min(end, start + elapsed * state.rate));
}

export function readClockCommand(value: unknown): ClockCommand {
  const row = object(value);
  switch (row.action) {
    case 'pause': case 'resume': return { action: row.action };
    case 'rate': return { action: 'rate', rate: speed(row.rate) };
    case 'seek': return { action: 'seek', at: utcInstant(row.at) };
    default: return invalid();
  }
}

export function transitionClock(state: ClockState, value: unknown, wallNow: Date): ClockState {
  const command = readClockCommand(value);
  const current = eventTimeAt(state, wallNow).toISOString();
  const ended = current === state.windowEnd;
  const next = { ...state, revision: state.revision + 1, epochStart: current,
    wallStart: wallNow.toISOString(), rate: ended ? 0 : state.rate };
  if (!Number.isSafeInteger(next.revision)) return invalid();
  switch (command.action) {
    case 'pause':
      if (next.rate > 0) next.resumeRate = next.rate;
      next.rate = 0;
      break;
    case 'resume':
      if (!ended) next.rate = next.resumeRate;
      break;
    case 'rate':
      next.resumeRate = command.rate;
      if (next.rate > 0) next.rate = command.rate;
      break;
    case 'seek':
      if (next.rate !== 0 || command.at < current || command.at > next.windowEnd) return invalid();
      next.epochStart = command.at;
      break;
  }
  return next;
}
