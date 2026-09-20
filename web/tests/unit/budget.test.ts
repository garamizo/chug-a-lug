import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
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

  it('serializes concurrent calls so no increment is lost', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'budget-'));
    const results = await Promise.all(Array.from({ length: 10 }, () => consumeBudget(dir, 'photos', 100)));
    expect(results.every((r) => r === true)).toBe(true);
    const budget = JSON.parse(readFileSync(join(dir, 'places', 'budget.json'), 'utf8'));
    expect(budget.photos).toBe(10);
  });

  it('lets exactly the limit through under concurrency', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'budget-'));
    const results = await Promise.all(Array.from({ length: 10 }, () => consumeBudget(dir, 'photos', 5)));
    expect(results.filter((r) => r === true)).toHaveLength(5);
    const budget = JSON.parse(readFileSync(join(dir, 'places', 'budget.json'), 'utf8'));
    expect(budget.photos).toBe(5);
  });
});
