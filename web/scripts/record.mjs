#!/usr/bin/env node
// Records Metra's realtime feeds to data/recordings/<name>/ until interrupted. M4's replayer reads
// these back. Run it on a Saturday: `just record saturday`.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

// This lives under web/ so Node resolves gtfs-realtime-bindings from web/node_modules (the repo root
// has no package.json). Paths come from this file's own location rather than the working directory,
// so .env and data/ are found wherever it is launched from.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const FEEDS = ['positions', 'tripupdates', 'alerts'];

const name = process.argv[2];
if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) {
  console.error('Usage: just record <name>   (letters, digits, dash, underscore)');
  process.exit(1);
}

// Read .env without a dependency: KEY=value lines, ignoring comments.
const envFile = join(ROOT, '.env');
const env = { ...process.env };
try {
  for (const line of (await readFile(envFile, 'utf8')).split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env: rely on the environment */ }

const token = env.METRA_API_TOKEN;
const base = env.METRA_RT_BASE || 'https://gtfspublic.metrarr.com/gtfs/public';
if (!token) { console.error('METRA_API_TOKEN is not set; nothing to record.'); process.exit(1); }

const dir = join(ROOT, 'data', 'recordings', name);
await mkdir(dir, { recursive: true });
const seen = new Map();
let written = 0;

async function tick() {
  for (const feed of FEEDS) {
    try {
      const res = await fetch(`${base}/${feed}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const ts = Number(FeedMessage.decode(bytes).header?.timestamp ?? 0);
      if (seen.get(feed) === ts) continue;
      seen.set(feed, ts);
      await writeFile(join(dir, `${ts}.${feed}.pb`), bytes);
      written++;
    } catch (err) {
      console.warn(`[record] ${feed}: ${err.message}`);
    }
  }
  process.stdout.write(`\r${written} snapshots in data/recordings/${name}  `);
}

console.log(`Recording ${FEEDS.join(', ')} to data/recordings/${name}. Ctrl-C to stop.`);
await tick();
const timer = setInterval(tick, 30_000);
process.on('SIGINT', () => { clearInterval(timer); console.log(`\nStopped. ${written} snapshots.`); process.exit(0); });
