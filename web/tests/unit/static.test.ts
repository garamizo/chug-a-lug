import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStaticLoader } from '../../src/lib/server/metra/static';

const zipPath = resolve(import.meta.dirname, '../fixtures/gtfs.zip');
const zipBytes = readFileSync(zipPath);

function fakeFetch(published: string, fail = false, calls: string[] = []) {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (fail) throw new Error('offline');
    if (url.endsWith('published.txt')) return new Response(published);
    return new Response(zipBytes);
  }) as unknown as typeof fetch;
}

describe('static loader', () => {
  it('loads a file: URL without touching the network', async () => {
    const loader = createStaticLoader({ url: pathToFileURL(zipPath).href, publishedUrl: 'http://invalid/published.txt', dataDir: mkdtempSync(join(tmpdir(), 'gtfs-')), fetchImpl: fakeFetch('', true) });
    const s = await loader.getSchedule();
    expect(s.lines.map((l) => l.routeId)).toEqual(['UP-W', 'MD-W', 'BNSF']);
    expect(loader.status().source).toBe('file');
  });

  it('downloads once, caches on disk, and reuses the cache when offline', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'gtfs-'));
    const calls: string[] = [];
    const first = createStaticLoader({ url: 'http://x/schedule.zip', publishedUrl: 'http://x/published.txt', dataDir, fetchImpl: fakeFetch('09/18/26 02:20:03 AM', false, calls) });
    await first.getSchedule();
    expect(first.status().source).toBe('download');
    expect(existsSync(join(dataDir, 'gtfs', 'schedule.zip'))).toBe(true);
    expect(readFileSync(join(dataDir, 'gtfs', 'published.txt'), 'utf8')).toBe('09/18/26 02:20:03 AM');
    await first.getSchedule();
    expect(calls.filter((u) => u.endsWith('schedule.zip'))).toHaveLength(1);

    const offline = createStaticLoader({ url: 'http://x/schedule.zip', publishedUrl: 'http://x/published.txt', dataDir, fetchImpl: fakeFetch('', true) });
    const s = await offline.getSchedule();
    expect(s.trips.length).toBeGreaterThan(0);
    expect(offline.status()).toMatchObject({ source: 'cache', publishedAt: '09/18/26 02:20:03 AM' });
  });

  it('re-downloads when published.txt changes after the refresh interval', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'gtfs-'));
    const calls: string[] = [];
    let published = 'v1';
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input); calls.push(url);
      return url.endsWith('published.txt') ? new Response(published) : new Response(zipBytes);
    }) as unknown as typeof fetch;
    const loader = createStaticLoader({ url: 'http://x/schedule.zip', publishedUrl: 'http://x/published.txt', dataDir, fetchImpl, refreshMs: 0 });
    await loader.getSchedule();
    await loader.getSchedule();
    expect(calls.filter((u) => u.endsWith('schedule.zip'))).toHaveLength(1);
    published = 'v2';
    await loader.getSchedule();
    expect(calls.filter((u) => u.endsWith('schedule.zip'))).toHaveLength(2);
    expect(loader.status().publishedAt).toBe('v2');
  });
});
