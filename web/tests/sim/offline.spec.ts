import { expect, test } from '@playwright/test';
import { login } from '../e2e/helpers';
test('production service worker boots an offline route without fabricating Railroad Time', async ({ page, context }, info) => {
  await login(page, 'Offline Rehearsal Crew', process.env.CREW_PASSWORD!);
  await page.goto('/route');
  await expect(page.getByTestId('simulation-status')).toContainText('Synchronized');
  await expect(page.getByText('Rehearsal Tap', { exact: true })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(() => page.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open('chugalug');
    open.onsuccess = () => { const db = open.result; const get = db.transaction('mirror').objectStore('mirror').get('route'); get.onsuccess = () => { resolve(get.result?.runId); db.close(); }; };
  }))).toBe('browser-fixture');
  await context.setOffline(true); await page.reload();
  await expect(page.getByTestId('mirror-notice')).toBeVisible();
  await expect(page.getByText('Rehearsal Tap', { exact: true })).toBeVisible();
  await expect(page.getByTestId('simulation-status')).toContainText('Railroad Time is unavailable');
  await expect(page.getByTestId('simulation-status')).toContainText('Not synchronized');
  await expect(page.getByTestId('board-compact')).toHaveCount(0);
  await expect(page.getByTestId('mirror-notice')).not.toContainText('Dec');
  await page.screenshot({ path: info.outputPath('offline.png'), fullPage: true });
  await context.setOffline(false);
  await expect(page.getByTestId('simulation-status')).toContainText('Synchronized', { timeout: 10_000 });
  await expect(page.getByTestId('mirror-notice')).toHaveCount(0);
  const cachesUsed = await page.evaluate(async () => {
    const keys: string[] = [];
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) keys.push(req.url);
    return keys;
  });
  expect(cachesUsed.filter(url => /\/api\/(sim|metra)\//.test(url))).toEqual([]);
});
