// Monthly Google call counters so a bug cannot run up a bill. Stored next to the places cache.
import { join } from 'node:path';
import { readJson, writeJson } from './cache';

type Budget = { month: string; details: number; photos: number };

export async function consumeBudget(dataDir: string, kind: 'details' | 'photos', limit: number): Promise<boolean> {
  const path = join(dataDir, 'places', 'budget.json');
  const month = new Date().toISOString().slice(0, 7);
  let b = await readJson<Budget>(path);
  if (!b || b.month !== month) b = { month, details: 0, photos: 0 };
  if (b[kind] >= limit) return false;
  b[kind] += 1;
  await writeJson(path, b);
  return true;
}
