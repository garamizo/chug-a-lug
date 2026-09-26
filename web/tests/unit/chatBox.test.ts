import { describe, expect, it } from 'vitest';
import { CHAT_EMOJI, composerMode, draftAfterFailedSend, insertAt } from '../../src/lib/chatBox';

describe('chat box', () => {
  it('offers sixteen crawl emoji', () => {
    expect(CHAT_EMOJI).toHaveLength(16);
    expect(new Set(CHAT_EMOJI).size).toBe(16);
  });
  it('is a camera until there is real text', () => {
    expect(composerMode('', true)).toBe('camera');
    expect(composerMode('   ', true)).toBe('camera');
    expect(composerMode('hi', true)).toBe('send');
    expect(composerMode('', false)).toBe('send');
  });
  it('a failed send gives the text back only if nothing new was typed', () => {
    expect(draftAfterFailedSend('', 'On my way')).toBe('On my way');
    expect(draftAfterFailedSend('  ', 'On my way')).toBe('On my way');
    expect(draftAfterFailedSend('Also bring cash', 'On my way')).toBe('Also bring cash');
  });
  it('inserts at the caret, replacing a selection', () => {
    expect(insertAt('Save me', '🍕', 7, 7)).toEqual({ text: 'Save me🍕', caret: 9 });
    expect(insertAt('ab', '🍻', 1, 1)).toEqual({ text: 'a🍻b', caret: 3 });
    expect(insertAt('abc', 'X', 1, 2)).toEqual({ text: 'aXc', caret: 2 });
  });
});
