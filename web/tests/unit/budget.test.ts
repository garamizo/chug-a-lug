import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumeBudget } from '../../src/lib/server/places/budget';

describe('consumeBudget', () => {
  it('counts per month and refuses past the limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'budget-'));
    expect(await consumeBudget(dir, 'photos', 2)).toBe(true);
    expect(await consumeBudget(dir, 'photos', 2)).toBe(true);
    expect(await consumeBudget(dir, 'photos', 2)).toBe(false);
    expect(await consumeBudget(dir, 'details', 1)).toBe(true);
    expect(await consumeBudget(dir, 'details', 1)).toBe(false);
  });
});
