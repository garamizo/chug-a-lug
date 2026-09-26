import { describe, expect, it } from 'vitest';
import { nameColour } from '../../src/lib/chatColour';

describe('nameColour', () => {
  it('is stable per person and one of the palette', () => {
    expect(nameColour('abc')).toBe(nameColour('abc'));
    expect(nameColour('abc')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
