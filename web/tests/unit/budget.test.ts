import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

  it('counts a kind that an older budget file does not have yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'budget-'));
    mkdirSync(join(dir, 'places'), { recursive: true });
    writeFileSync(join(dir, 'places', 'budget.json'), JSON.stringify({ month: new Date().toISOString().slice(0, 7), details: 3, photos: 4 }));
    expect(await consumeBudget(dir, 'nearby', 2)).toBe(true);
    expect(await consumeBudget(dir, 'nearby', 2)).toBe(true);
    expect(await consumeBudget(dir, 'nearby', 2)).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'places', 'budget.json'), 'utf8'))).toMatchObject({ details: 3, photos: 4, nearby: 2 });
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
