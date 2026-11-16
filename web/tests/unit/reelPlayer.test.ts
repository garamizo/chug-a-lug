import { describe, expect, it } from 'vitest';
import {
  advance, isPaused, nextSlide, pauseReel, prevSlide, progressOf, replayReel, resumeReel, skipSlide, startReel
} from '../../src/lib/live/reelPlayer';

// Title 3 s, a photo 4.5 s, a message 4 s, the finale 6 s: the clock is a plain number of milliseconds.
const DURATIONS = [3000, 4500, 4000, 6000];

describe('reel player', () => {
  it('plays each slide for its own duration, then the next', () => {
    let r = startReel(DURATIONS, 0);
    r = advance(r, 2999);
    expect(r.index).toBe(0);
    expect(progressOf(r, 1500)).toBeCloseTo(0.5);
    r = advance(r, 3000);
    expect(r.index).toBe(1);
    expect(progressOf(r, 3000)).toBe(0);
    r = advance(r, 3000 + 4499);
    expect(r.index).toBe(1);
    r = advance(r, 3000 + 4500);
    expect(r.index).toBe(2);
  });

  it('a phone that slept moves on one slide, not through the whole reel', () => {
    const r = advance(startReel(DURATIONS, 0), 60_000);
    expect(r.index).toBe(1);
    expect(progressOf(r, 60_000)).toBe(0);
  });

  it('stops on the last slide when it runs out', () => {
    let r = startReel(DURATIONS, 0);
    r = nextSlide(nextSlide(nextSlide(r, 10), 20), 30);
    expect(r.index).toBe(3);
    expect(r.done).toBe(false);
    r = advance(r, 30 + 6000);
    expect(r).toMatchObject({ index: 3, done: true });
    expect(progressOf(r, 99_999)).toBe(1);
    expect(advance(r, 99_999)).toBe(r);
    expect(isPaused(r)).toBe(false);
  });

  it('next and previous start the slide over; previous on the first restarts it', () => {
    let r = startReel(DURATIONS, 0);
    r = prevSlide(r, 2000);
    expect(r.index).toBe(0);
    expect(progressOf(r, 2000)).toBe(0);
    r = nextSlide(r, 2500);
    expect(r.index).toBe(1);
    expect(progressOf(r, 2500)).toBe(0);
    r = prevSlide(r, 2600);
    expect(r.index).toBe(0);
    // Next on the finale ends the reel there; previous from the end goes back and plays again.
    r = nextSlide(nextSlide(nextSlide(nextSlide(r, 3000), 3000), 3000), 3000);
    expect(r).toMatchObject({ index: 3, done: true });
    r = prevSlide(r, 4000);
    expect(r).toMatchObject({ index: 2, done: false });
    expect(advance(r, 4000 + 4000).index).toBe(3);
  });

  it('holding pauses and keeps the slide where it was', () => {
    let r = startReel(DURATIONS, 0);
    r = pauseReel(r, 1000);
    expect(isPaused(r)).toBe(true);
    expect(advance(r, 50_000)).toBe(r);
    expect(progressOf(r, 50_000)).toBeCloseTo(1000 / 3000);
    r = resumeReel(r, 50_000);
    expect(isPaused(r)).toBe(false);
    expect(advance(r, 51_999).index).toBe(0);
    expect(advance(r, 52_000).index).toBe(1);
  });

  it('tapping on while paused plays the next slide', () => {
    let r = pauseReel(startReel(DURATIONS, 0), 1000);
    r = nextSlide(r, 2000);
    expect(r.index).toBe(1);
    expect(isPaused(r)).toBe(false);
    expect(advance(r, 2000 + 4500).index).toBe(2);
  });

  it('a slide whose image fails is skipped, now or when the reel gets there', () => {
    let r = startReel(DURATIONS, 0);
    // A later photo fails while it preloads: the reel goes from the title straight to the message.
    r = skipSlide(r, 1, 100);
    expect(r.index).toBe(0);
    r = advance(r, 3000);
    expect(r.index).toBe(2);
    expect(prevSlide(r, 3100).index).toBe(0);
    // The slide on screen fails: the next one plays at once.
    r = skipSlide(r, 2, 3200);
    expect(r.index).toBe(3);
    expect(progressOf(r, 3200)).toBe(0);
  });

  it('watch again starts from the top', () => {
    let r = advance(nextSlide(nextSlide(nextSlide(startReel(DURATIONS, 0), 1), 2), 3), 3 + 6000);
    expect(r.done).toBe(true);
    r = replayReel(r, 10_000);
    expect(r).toMatchObject({ index: 0, done: false });
    expect(advance(r, 13_000).index).toBe(1);
  });
});
