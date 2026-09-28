import { describe, expect, it } from 'vitest';
import { cloneTitle, hookCode, normalizeTitle, titleError, TITLE_MAX } from '../../src/lib/routeTitle';
import { copy } from '../../src/lib/labels';

describe('normalizeTitle', () => {
  it('trims for display and keys case- and space-insensitively', () => {
    expect(normalizeTitle('  Loop   Crawl ')).toEqual({ display: 'Loop   Crawl', key: 'loop crawl' });
  });
  it('refuses empty, blank, too long and non-strings', () => {
    expect(normalizeTitle('')).toBeNull();
    expect(normalizeTitle('   ')).toBeNull();
    expect(normalizeTitle('x'.repeat(TITLE_MAX + 1))).toBeNull();
    expect(normalizeTitle(42)).toBeNull();
    expect(normalizeTitle('x'.repeat(TITLE_MAX))?.display).toHaveLength(TITLE_MAX);
  });
});

describe('cloneTitle', () => {
  it('prefixes the first copy and numbers later ones', () => {
    expect(cloneTitle('Loop Crawl', 1)).toBe(`${copy.cloneTitlePrefix} Loop Crawl`);
    expect(cloneTitle('Loop Crawl', 2)).toBe(`${copy.cloneTitlePrefix} Loop Crawl (2)`);
  });
  it('cuts the base so the suffix still fits in 80', () => {
    const t = cloneTitle('x'.repeat(80), 12);
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(t.endsWith(' (12)')).toBe(true);
    expect(cloneTitle('x'.repeat(80), 1).length).toBe(TITLE_MAX);
  });
});

describe('hookCode', () => {
  it('undoes PocketBase sentence-casing of the hook message, from a response or a plain Error', () => {
    expect(hookCode({ response: { message: 'Title_taken.' } })).toBe('title_taken');
    expect(hookCode(new Error('Route_gone.'))).toBe('route_gone');
    expect(hookCode(null)).toBeNull();
  });
});

describe('titleError', () => {
  it('maps the hook codes to copy, from a PocketBase error (sentence-cased on the wire) or a plain Error', () => {
    expect(titleError({ response: { message: 'Title_taken.' } })).toBe(copy.titleTaken);
    expect(titleError(new Error('Title_invalid.'))).toBe(copy.titleInvalid);
    expect(titleError(new Error('boom'))).toBeNull();
  });
});
