// The reel's playhead, as plain values: which slide, how far into it, paused or not. Every step takes
// the time it happens at (wall-clock milliseconds, `performance.now()` in the player), so the timing
// is tested with a number instead of a timer. Each step returns a new state, or the same one if
// nothing changed.

export type ReelState = {
  durations: readonly number[];
  index: number;
  /** Milliseconds of the current slide played before `since`. */
  elapsed: number;
  /** When the current run of play started; null while paused or ended. */
  since: number | null;
  /** On the last slide, its time used up: the reel waits there for Watch again or Done. */
  done: boolean;
  /** Slides whose image failed to load: never shown. */
  skipped: readonly number[];
};

const playing = (s: ReelState, index: number, now: number): ReelState => ({ ...s, index, elapsed: 0, since: now, done: false });
const ended = (s: ReelState): ReelState => ({ ...s, elapsed: s.durations[s.index] ?? 0, since: null, done: true });

function step(s: ReelState, from: number, by: 1 | -1): number | null {
  for (let i = from + by; i >= 0 && i < s.durations.length; i += by) if (!s.skipped.includes(i)) return i;
  return null;
}

export function startReel(durations: readonly number[], now: number): ReelState {
  return { durations, index: 0, elapsed: 0, since: now, done: false, skipped: [] };
}

export const isPaused = (s: ReelState): boolean => s.since === null && !s.done;

const elapsedOf = (s: ReelState, now: number): number => s.elapsed + (s.since === null ? 0 : Math.max(0, now - s.since));

/** How much of the current slide has played, 0 to 1. */
export function progressOf(s: ReelState, now: number): number {
  const d = s.durations[s.index] ?? 0;
  return d > 0 ? Math.min(1, elapsedOf(s, now) / d) : 1;
}

/**
 * The clock moved on: at the end of a slide, the next one starts now. One slide at a time, so a phone
 * that slept through the reel resumes where it was rather than at the finale.
 */
export function advance(s: ReelState, now: number): ReelState {
  if (s.since === null || elapsedOf(s, now) < (s.durations[s.index] ?? 0)) return s;
  const next = step(s, s.index, 1);
  return next === null ? ended(s) : playing(s, next, now);
}

/** Tap right, or →: the next slide, playing; past the last one the reel ends. */
export function nextSlide(s: ReelState, now: number): ReelState {
  if (s.done) return s;
  const next = step(s, s.index, 1);
  return next === null ? ended(s) : playing(s, next, now);
}

/** Tap left, or ←: the slide before, or this one from its start when it is the first. */
export function prevSlide(s: ReelState, now: number): ReelState {
  return playing(s, step(s, s.index, -1) ?? s.index, now);
}

/** Press and hold, or Space. */
export function pauseReel(s: ReelState, now: number): ReelState {
  return s.since === null ? s : { ...s, elapsed: elapsedOf(s, now), since: null };
}

export function resumeReel(s: ReelState, now: number): ReelState {
  return isPaused(s) ? { ...s, since: now } : s;
}

/** A slide's image failed: drop it, and if it is on screen, play the next one now. */
export function skipSlide(s: ReelState, index: number, now: number): ReelState {
  if (s.skipped.includes(index)) return s;
  const out = { ...s, skipped: [...s.skipped, index] };
  if (index !== s.index || s.done) return out;
  const next = step(out, index, 1);
  return next === null ? ended(out) : playing(out, next, now);
}

/** Watch again. */
export function replayReel(s: ReelState, now: number): ReelState {
  return playing(s, s.skipped.includes(0) ? (step(s, 0, 1) ?? 0) : 0, now);
}
