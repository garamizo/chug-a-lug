import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { admin } from './setup';

test('web restart preserves paused time and includes downtime while running', async ({ request }) => {
  const pb = await admin();
  const login = await pb.send('/api/crawl/login', { method: 'POST', body: { name: 'Restart Conductor', password: process.env.ADMIN_PASSWORD } });
  const headers = { Authorization: login.token };
  // Previous rehearsal reaches the window end. A fresh isolated clock state is setup here solely
  // to test restart persistence; this is a private seed, never a UI rewind or application endpoint.
  await pb.collection('simulation_clock').update('simulationclock', { epoch_start: '2026-12-26T18:20:00Z', wall_start: new Date().toISOString(), rate: 0, revision: 100 });
  const clock = async () => {
    const response = await request.get('/api/sim/clock', { headers });
    expect(response.ok()).toBe(true); return response.json();
  };
  const restart = async () => {
    const before = JSON.parse(await readFile(process.env.SIM_WEB_CONTROL!, 'utf8'));
    process.kill(before.pid, 'SIGUSR2');
    await expect.poll(async () => JSON.parse(await readFile(process.env.SIM_WEB_CONTROL!, 'utf8')).generation).toBe(before.generation + 1);
    await expect.poll(async () => {
      try { return (await request.get('/api/sim/clock', { headers, timeout: 1000 })).status(); } catch { return 0; }
    }, { timeout: 20_000 }).toBe(200);
  };
  const paused = await clock(); await restart();
  expect(await clock()).toMatchObject({ runId: paused.runId, revision: paused.revision, eventNow: paused.eventNow, rate: 0 });
  const resumed = await request.post('/api/sim/clock', { headers, data: { action: 'resume', expectedRevision: paused.revision } });
  expect(resumed.ok()).toBe(true);
  const running = await resumed.json(); await restart(); const after = await clock();
  expect(after.revision).toBe(running.revision); expect(after.rate).toBeGreaterThan(0);
  const elapsed = Date.parse(after.serverWallNow) - Date.parse(running.serverWallNow);
  expect(Date.parse(after.eventNow) - Date.parse(running.eventNow)).toBe(elapsed * running.rate);
});
