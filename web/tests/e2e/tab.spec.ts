import { expect, test } from '@playwright/test';
import { clearRoutes, login, openTab, seedLockedCrawl } from './helpers';
import { copy } from '../../src/lib/labels';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const DATE = '2026-12-26';

async function tabDay(page: import('@playwright/test').Page, name: string) {
  await page.route('**/api/metra/**', r => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  await login(page, name, ADMIN);
  await clearRoutes();
  await seedLockedCrawl({ ownerName: name, eventDate: DATE, startTime: '12:00', departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
  await page.goto('/live');
  await openTab(page);
}

test('a drink that cannot be saved takes its tap back and says so; one that saved stays counted when the refresh fails', async ({ page }) => {
  await tabDay(page, 'E2E Tab Offline');
  // The create call sends `?expand=...`, so the pattern needs a trailing wildcard to match the query string.
  await page.route('**/api/collections/drink_entries/records**', r => r.request().method() === 'POST' ? r.abort() : r.continue());
  await page.getByTestId('drink-shot').click();
  await expect(page.getByRole('alert')).toHaveText(copy.noSignal);
  await expect(page.getByTestId('drink-shot').locator('.count')).toHaveText('0');

  // A saved drink stays counted when the refresh after it fails.
  await page.unroute('**/api/collections/drink_entries/records**');
  await page.route('**/api/collections/drink_entries/records**', r => r.request().method() === 'GET' ? r.abort() : r.continue());
  await page.getByTestId('drink-cocktail').click();
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await expect(page.getByTestId('drink-cocktail').locator('.count')).toHaveText('1');
});

test('overlapping taps with a slow server count exactly once each', async ({ page }) => {
  await tabDay(page, 'E2E Tab Slow');
  let posts = 0;
  // Delay the RESPONSE, not the request: the create still reaches the server (and PocketBase's
  // realtime broadcast) right away, so the saved row can land via realtime/reload before this
  // fetch's own promise resolves in the page — the exact interleaving this test exists to cover.
  await page.route('**/api/collections/drink_entries/records**', async r => {
    if (r.request().method() !== 'POST') return r.continue();
    posts++;
    const response = await r.fetch();
    await new Promise(res => setTimeout(res, 800));
    await r.fulfill({ response });
  });
  // Barrier: the feed reload the app starts after a save (live/+page.svelte:85-87). loadFeed() reads four
  // collections and applies them together (day.svelte.ts:269), so wait for every collection read that
  // STARTED after the second POST answered to finish, then let the page apply them.
  let answered = 0;
  const after: import('@playwright/test').Request[] = [];
  page.on('requestfinished', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/collections/drink_entries/records')) answered++;
  });
  page.on('request', (req) => {
    if (answered >= 2 && req.method() === 'GET' && req.url().includes('/api/collections/')) after.push(req);
  });
  const beer = page.getByTestId('drink-beer').locator('.count');
  await page.getByTestId('drink-beer').click();
  await page.getByTestId('drink-beer').click();
  await expect(beer).toHaveText('2');            // instantly, from the pending taps
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await expect.poll(() => answered).toBe(2);       // both saved
  // loadFeed() reads these four together and applies nothing until all have answered.
  const feed = ['/drink_entries/', '/media/', '/chat_messages/', '/reactions/'];
  await expect.poll(() => feed.every((c) => after.some((r) => r.url().includes(c)))).toBe(true);
  await Promise.all(after.map(async (r) => (await r.response())?.finished()));
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));   // the reload has been applied
  await expect(beer).toHaveText('2');
  await expect(page.getByTestId('tab-total')).toHaveText('2');
  expect(posts).toBe(2);
});

test('a failed Undo keeps its button so it can be retried', async ({ page }) => {
  await tabDay(page, 'E2E Tab Undo Retry');
  await page.getByTestId('drink-beer').click();
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  const block = (r: import('@playwright/test').Route) => r.request().method() === 'DELETE' ? r.abort() : r.continue();
  await page.route('**/api/collections/drink_entries/records/**', block);
  await page.getByTestId('tab-undo').click();
  await expect(page.getByRole('alert')).toHaveText(copy.noSignal);
  await expect(page.getByTestId('tab-undo')).toBeVisible();
  await page.clock.runFor(10_000);                 // a failed toast does not time out
  await expect(page.getByTestId('tab-undo')).toBeVisible();
  await page.unroute('**/api/collections/drink_entries/records/**', block);
  await page.getByTestId('tab-undo').click();
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
  await expect(page.getByTestId('tab-toast')).toBeHidden();
});

test('a 404 on Undo (already removed elsewhere) is treated as done, not a failure', async ({ page }) => {
  await tabDay(page, 'E2E Tab Undo Already Gone');
  await page.getByTestId('drink-beer').click();
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await page.route('**/api/collections/drink_entries/records/**', async (r) => {
    if (r.request().method() !== 'DELETE') return r.continue();
    await r.fetch();   // the row really goes, as when someone else removed it first
    await r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 404, message: 'not found', data: {} }) });
  });
  await page.getByTestId('tab-undo').click();
  await expect(page.getByTestId('tab-toast')).toBeHidden();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
});

test('a repeat Undo tap while one is in flight is ignored, not sent twice', async ({ page }) => {
  await tabDay(page, 'E2E Tab Undo Inflight');
  await page.getByTestId('drink-beer').click();
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  let deletes = 0;
  await page.route('**/api/collections/drink_entries/records/**', async r => {
    if (r.request().method() !== 'DELETE') return r.continue();
    deletes++;
    await new Promise((res) => setTimeout(res, 500));
    await r.continue();
  });
  const deleted = page.waitForResponse((res) => res.request().method() === 'DELETE' && res.url().includes('/api/collections/drink_entries/records/'));
  await page.getByTestId('tab-undo').click();
  await page.getByTestId('tab-undo').click();
  await deleted;
  expect(deletes).toBe(1);
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
});

test('after the toast is gone the newest drink can be undone, but never a tap that has not saved yet', async ({ page }) => {
  // Regression: showUndoLast used to gate only on the toast, but the toast is cleared the instant a
  // new tap starts, so the fallback could briefly target the unsaved draft itself — deleting a row
  // that doesn't exist yet 404s while the tap goes on to save anyway.
  await tabDay(page, 'E2E Tab Undo Last Pending');
  await page.getByTestId('drink-food').click();
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await page.clock.runFor(5_000);
  await expect(page.getByTestId('tab-toast')).toBeHidden();
  await expect(page.getByTestId('tab-undo-last')).toBeVisible();

  await page.route('**/api/collections/drink_entries/records**', async r => {
    if (r.request().method() !== 'POST') return r.continue();
    const response = await r.fetch();
    await new Promise(res => setTimeout(res, 800));
    await r.fulfill({ response });
  });
  await page.getByTestId('drink-beer').click();
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('1');
  // While the beer tap is still in flight, neither Undo affordance may be offered for it.
  await expect(page.getByTestId('tab-toast')).toBeHidden();
  await expect(page.getByTestId('tab-undo-last')).toBeHidden();

  await expect(page.getByTestId('tab-toast')).toBeVisible();

  // Once that toast is gone too, the newest drink here can still be undone.
  await page.clock.runFor(5_000);
  await expect(page.getByTestId('tab-toast')).toBeHidden();
  await page.getByTestId('tab-undo-last').click();
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
});

test('a second tap before the first toast fades retargets Undo, not the earlier one', async ({ page }) => {
  // Regression for a race the sim rehearsal test caught: a stale toast must not let Undo remove
  // the wrong drink when a second tap lands while the first toast is still showing.
  await tabDay(page, 'E2E Tab Retarget');
  await page.getByTestId('drink-beer').click();
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await page.getByTestId('drink-water').click();
  await expect(page.getByTestId('drink-water').locator('.count')).toHaveText('1');
  await page.getByTestId('tab-undo').click();
  await expect(page.getByTestId('drink-water').locator('.count')).toHaveText('0');
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('1');
});

test('the Tab offers five counters and a camera; the tab bar opens it from any screen, and it closes without losing the count', async ({ page }) => {
  await tabDay(page, 'E2E Tab Sheet');
  // Five illustrated personal counters (no wine; water is NA) and a camera picker.
  await expect(page.getByTestId('drink-wine')).toHaveCount(0);
  await expect(page.getByTestId('drink-water')).toContainText('NA');
  await expect(page.getByTestId('camera-button')).toBeVisible();
  await expect(page.getByTestId('freight-camera')).toHaveAttribute('capture', 'environment');
  await page.getByTestId('drink-beer').click();
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tab-sheet')).toHaveCount(0);
  // The toast outlives the sheet, and the bar carries the day's count.
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await expect(page.getByTestId('tab-bar-total')).toHaveText('1');
  await expect(page.getByTestId('tab-menu')).toHaveCount(0);

  await page.getByTestId('tab-crew').click();
  await expect(page).toHaveURL(/\/crew$/);
  await page.getByTestId('tab-drinks').click();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('tab-sheet')).toBeVisible();
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('1');
  await page.getByTestId('tab-scrim').click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId('tab-sheet')).toHaveCount(0);
});
