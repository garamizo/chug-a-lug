import { expect, test } from '@playwright/test';
import { clearLockedCrawls, login, seedLockedCrawl } from './helpers';
import { copy } from '../../src/lib/labels';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const DATE = '2026-12-26';

test('one tap logs a drink at the current stop, and Undo takes it back', async ({ page }) => {
  await page.route('**/api/metra/**', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  await login(page, 'E2E Tab Skipper', ADMIN);
  await clearLockedCrawls();
  await seedLockedCrawl({
    ownerName: 'E2E Tab Skipper', eventDate: DATE, startTime: '12:00',
    departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z'
  });
  await page.clock.install({ time: new Date('2026-12-26T19:00:00.000Z') });
  await page.goto('/live');

  const beer = page.getByTestId('drink-beer');
  await expect(beer).toContainText('0');
  await beer.click();
  await expect(beer).toContainText('1');
  await expect(page.getByTestId('tab-total')).toContainText('1');

  await page.getByTestId('tab-undo').click();
  await expect(beer).toContainText('0');
});

test('Tab offers five illustrated personal counters and a camera picker', async ({ page }) => {
  await page.route('**/api/metra/**', r => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  await login(page, 'E2E Personal Tab', ADMIN);
  await clearLockedCrawls();
  await seedLockedCrawl({ ownerName: 'E2E Personal Tab', eventDate: DATE, startTime: '12:00', departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
  await page.goto('/live');
  await expect(page.getByTestId('drink-wine')).toHaveCount(0);
  await expect(page.getByTestId('drink-water')).toContainText('Non-alcoholic');
  await expect(page.getByTestId('freight-camera')).toHaveAttribute('capture', 'environment');
});

async function tabDay(page: import('@playwright/test').Page, name: string) {
  await page.route('**/api/metra/**', r => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  await login(page, name, ADMIN);
  await clearLockedCrawls();
  await seedLockedCrawl({ ownerName: name, eventDate: DATE, startTime: '12:00', departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
  await page.goto('/live');
}

test('a drink that cannot be saved takes its tap back and says so', async ({ page }) => {
  await tabDay(page, 'E2E Tab Offline');
  // The create call sends `?expand=...`, so the pattern needs a trailing wildcard to match the query string.
  await page.route('**/api/collections/drink_entries/records**', r => r.request().method() === 'POST' ? r.abort() : r.continue());
  await page.getByTestId('drink-shot').click();
  await expect(page.getByRole('alert')).toHaveText(copy.noSignal);
  await expect(page.getByTestId('drink-shot').locator('.count')).toHaveText('0');
});

test('overlapping taps with a slow server count exactly once each', async ({ page }) => {
  await tabDay(page, 'E2E Tab Slow');
  await page.route('**/api/collections/drink_entries/records', async r => {
    if (r.request().method() !== 'POST') return r.continue();
    await new Promise(res => setTimeout(res, 800));
    await r.continue();
  });
  const beer = page.getByTestId('drink-beer').locator('.count');
  await page.getByTestId('drink-beer').click();
  await page.getByTestId('drink-beer').click();
  await expect(beer).toHaveText('2');            // instantly, from the pending taps
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await page.waitForTimeout(1500);                // both saved; realtime reloads have landed
  await expect(beer).toHaveText('2');
  await expect(page.getByTestId('tab-total')).toHaveText('2');
});

test('a saved drink stays counted when the refresh after it fails', async ({ page }) => {
  await tabDay(page, 'E2E Tab Read Fails');
  await page.route('**/api/collections/drink_entries/records**', r => r.request().method() === 'GET' ? r.abort() : r.continue());
  await page.getByTestId('drink-cocktail').click();
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await expect(page.getByTestId('drink-cocktail').locator('.count')).toHaveText('1');
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

test('after the toast is gone, your newest drink here can still be undone', async ({ page }) => {
  await tabDay(page, 'E2E Tab Undo Last');
  await page.getByTestId('drink-food').click();
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await page.clock.runFor(5_000);
  await expect(page.getByTestId('tab-toast')).toBeHidden();
  await page.getByTestId('tab-undo-last').click();
  await expect(page.getByTestId('drink-food').locator('.count')).toHaveText('0');
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
