import { expect, test } from '@playwright/test';
import { login } from '../e2e/helpers';
import { awaitWaiting, readMark, restoreBuild, servedMark, swapBuild } from './swap';

test.afterAll(restoreBuild);

test('a deploy installs a waiting worker under a controlled page', async ({ page }) => {
  await login(page, 'Offline Rehearsal Crew', process.env.CREW_PASSWORD!);
  await page.goto('/route');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const before = servedMark();
  expect(await readMark(page)).toBe(before);
  await swapBuild();
  await awaitWaiting(page); // the deploy is found and waits; Task 5 adds what a tap then does
});
