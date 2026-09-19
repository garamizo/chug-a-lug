import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchedule, type Schedule } from '../../src/lib/metra/gtfs';

const dir = join(import.meta.dirname, 'gtfs');

export function fixtureFiles(): Record<string, string> {
  return Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
}

export function fixtureSchedule(): Schedule {
  return buildSchedule(fixtureFiles(), '2026-09-18T07:20:03.000Z');
}
