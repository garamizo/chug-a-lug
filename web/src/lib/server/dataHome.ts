// Where runtime state lives: the database, GTFS, the Places budget and recordings. Outside every
// checkout on purpose, so no git operation in any worktree can delete it. web/scripts/*.mjs and
// scripts/*.sh follow the same rule: DATA_DIR, then CHUG_DATA, then ~/.chug-a-lug.
import { homedir } from 'node:os';
import { join } from 'node:path';

export function dataHome(env: Record<string, string | undefined>, home = homedir()): string {
  const dir = env.DATA_DIR || env.CHUG_DATA || join(home, '.chug-a-lug');
  // .env values reach Node unexpanded; a shell would have turned ~ into the home directory.
  return dir === '~' || dir.startsWith('~/') ? join(home, dir.slice(1)) : dir;
}
