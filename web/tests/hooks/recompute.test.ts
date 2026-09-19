import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { loginToken, patch, post, del } from './setup';

type Hit = { method: string; url: string; secret: string | null };
const hits: Hit[] = [];
let server: Server;
let crew: { token: string; id: string };

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push({ method: req.method ?? '', url: req.url ?? '', secret: (req.headers['x-internal-secret'] as string) ?? null });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"legs":0,"impossible":0}');
  });
  await new Promise<void>((resolve) => server.listen(18095, '127.0.0.1', resolve));
  crew = await loginToken('Recompute Crew');
});

afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe('recompute trigger', () => {
  it('posts to the web server with the shared secret after stop writes and schedule edits', async () => {
    const it = await (await post('/api/collections/itineraries/records', { title: 'Trigger' }, crew.token)).json();
    const forThis = () => hits.filter((h) => h.url.includes(it.id));
    hits.length = 0;
    const stop = await (await post('/api/collections/stops/records', { itinerary: it.id, name: 'A', station_id: 'OTC' }, crew.token)).json();
    expect(forThis()).toHaveLength(1);
    expect(forThis()[0]).toEqual({ method: 'POST', url: `/api/internal/recompute?itinerary=${it.id}`, secret: 'hooks-test-secret' });
    await patch(`/api/collections/stops/records/${stop.id}`, { dwell_min: 45 }, crew.token);
    await del(`/api/collections/stops/records/${stop.id}`, crew.token);
    expect(forThis()).toHaveLength(3);
    hits.length = 0;
    await patch(`/api/collections/itineraries/records/${it.id}`, { title: 'Renamed' }, crew.token);
    expect(forThis()).toHaveLength(0);
    await patch(`/api/collections/itineraries/records/${it.id}`, { start_time: '12:30' }, crew.token);
    expect(forThis()).toHaveLength(1);
  });
});
