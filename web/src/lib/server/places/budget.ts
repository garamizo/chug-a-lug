// Monthly Google call counters so a bug cannot run up a bill. Stored next to the places cache.
import { join } from 'node:path';
import { readJson, writeJson } from './cache';

export type BudgetKind = 'details' | 'photos' | 'nearby';
type Budget = { month: string } & Partial<Record<BudgetKind, number>>;

// consumeBudget is a non-atomic read-modify-write on budget.json; a single in-process queue
// serializes every call so concurrent increments cannot interleave and lose counts (single Node
// server, so no cross-process file locking is needed).
let queue: Promise<unknown> = Promise.resolve();

export function consumeBudget(dataDir: string, kind: BudgetKind, limit: number): Promise<boolean> {
  const run = queue.catch(() => undefined).then(() => doConsumeBudget(dataDir, kind, limit));
  queue = run;
  return run;
}

async function doConsumeBudget(dataDir: string, kind: BudgetKind, limit: number): Promise<boolean> {
  const path = join(dataDir, 'places', 'budget.json');
  const month = new Date().toISOString().slice(0, 7);
  let b = await readJson<Budget>(path);
  if (!b || b.month !== month) b = { month, details: 0, photos: 0 };
  // Older budget files predate some kinds; a missing counter is zero.
  const used = b[kind] ?? 0;
  if (used >= limit) return false;
  b[kind] = used + 1;
  await writeJson(path, b);
  return true;
}
