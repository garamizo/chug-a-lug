import { expect, type Page } from '@playwright/test';
import { readFile, rename } from 'node:fs/promises';

// The production server serves `build`; `build-next` is the same app with a build mark. Swapping
// them and restarting the server stands in for a deploy. Tests get a fresh browser context each,
// but the server keeps the swapped build, so compare against servedMark(), never a literal.
let swaps = 0;
export const servedMark = () => (swaps % 2 ? 'next' : '');

const control = async () => JSON.parse(await readFile(process.env.SIM_WEB_CONTROL!, 'utf8'));

export async function swapBuild(): Promise<void> {
  await rename('build', 'build-swap');
  await rename('build-next', 'build');
  await rename('build-swap', 'build-next');
  swaps++;
  const before = await control();
  process.kill(before.pid, 'SIGUSR2');
  await expect.poll(async () => (await control()).generation).toBe(before.generation + 1);
  await expect.poll(async () => {
    try { return (await fetch('http://127.0.0.1:15173/login', { signal: AbortSignal.timeout(1000) })).status; } catch { return 0; }
  }, { timeout: 20_000 }).toBe(200);
}

export async function restoreBuild(): Promise<void> {
  if (swaps % 2) await swapBuild();
}

export const readMark = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector('meta[name="app-build"]')?.getAttribute('content') ?? '');

export async function awaitWaiting(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();
    return !!reg?.waiting;
  }), { timeout: 20_000 }).toBe(true);
}
