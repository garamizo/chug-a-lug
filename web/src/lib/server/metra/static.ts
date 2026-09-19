// Downloads Metra's static GTFS, caches it under <dataDir>/gtfs, and rebuilds the in-memory schedule
// when published.txt changes. A file: URL (tests, offline dev) skips the network entirely.
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchedule, unzipGtfs, type Schedule } from '$lib/metra/gtfs';

export type StaticConfig = { url: string; publishedUrl: string; dataDir: string; fetchImpl?: typeof fetch; refreshMs?: number };
export type StaticStatus = { publishedAt: string; loadedAt: string; source: 'file' | 'download' | 'cache' | 'none' };

export function createStaticLoader(cfg: StaticConfig) {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const refreshMs = cfg.refreshMs ?? 10 * 60_000;
  const dir = join(cfg.dataDir, 'gtfs');
  const zipPath = join(dir, 'schedule.zip');
  const publishedPath = join(dir, 'published.txt');
  let schedule: Schedule | null = null;
  let loading: Promise<Schedule> | null = null;
  let lastCheck = 0;
  let status: StaticStatus = { publishedAt: '', loadedAt: '', source: 'none' };

  const build = (bytes: Uint8Array, publishedAt: string, source: StaticStatus['source']) => {
    schedule = buildSchedule(unzipGtfs(bytes), publishedAt);
    status = { publishedAt, loadedAt: new Date().toISOString(), source };
    return schedule;
  };

  async function readCache(): Promise<{ bytes: Uint8Array; publishedAt: string } | null> {
    try {
      return { bytes: new Uint8Array(await readFile(zipPath)), publishedAt: (await readFile(publishedPath, 'utf8')).trim() };
    } catch { return null; }
  }

  async function load(): Promise<Schedule> {
    if (cfg.url.startsWith('file:')) {
      if (schedule) return schedule;
      const path = fileURLToPath(cfg.url);
      return build(new Uint8Array(await readFile(path)), (await stat(path)).mtime.toISOString(), 'file');
    }
    let published = '';
    try {
      const res = await fetchImpl(cfg.publishedUrl);
      if (!res.ok) throw new Error(`published.txt HTTP ${res.status}`);
      published = (await res.text()).trim();
    } catch (err) {
      if (schedule) { console.warn('[metra] published.txt check failed, keeping current schedule:', (err as Error).message); return schedule; }
      const cached = await readCache();
      if (cached) { console.warn('[metra] offline, using cached schedule'); return build(cached.bytes, cached.publishedAt, 'cache'); }
      throw err;
    }
    if (schedule && published === status.publishedAt) return schedule;
    const cached = schedule ? null : await readCache();
    if (cached && cached.publishedAt === published) return build(cached.bytes, published, 'cache');
    const res = await fetchImpl(cfg.url);
    if (!res.ok) throw new Error(`schedule.zip HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await mkdir(dir, { recursive: true });
    await writeFile(zipPath, bytes);
    await writeFile(publishedPath, published);
    return build(bytes, published, 'download');
  }

  return {
    async getSchedule(): Promise<Schedule> {
      if (schedule && Date.now() - lastCheck < refreshMs) return schedule;
      if (!loading) {
        loading = load().then((s) => { lastCheck = Date.now(); return s; }).finally(() => { loading = null; });
      }
      return loading;
    },
    status: () => status
  };
}
