import { expect, test } from '@playwright/test';
import { clearLockedCrawls, login, seedLockedCrawl } from './helpers';
import { copy } from '../../src/lib/labels';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const DATE = '2026-12-26';

// A 1x1 GIF: small enough to inline, real enough for PocketBase to store and thumbnail.
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test('a photo uploads and appears in the strip for this stop', async ({ page }) => {
  await page.route('**/api/metra/**', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  await login(page, 'E2E Freight Skipper', ADMIN);
  await clearLockedCrawls();
  await seedLockedCrawl({
    ownerName: 'E2E Freight Skipper', eventDate: DATE, startTime: '12:00',
    departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z'
  });
  await page.clock.install({ time: new Date('2026-12-26T19:00:00.000Z') });
  await page.goto('/live');

  await expect(page.getByTestId('action-photo')).toBeEnabled();
  await page.getByTestId('freight-input').setInputFiles({ name: 'bar.gif', mimeType: 'image/gif', buffer: GIF });
  await expect(page.getByTestId('freight-strip').locator('img')).toHaveCount(1);
});

test('a rejected middle upload still sends the last photo and reports the partial batch', async ({ page }) => {
  await page.route('**/api/metra/**', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  await login(page, 'E2E Freight Skipper', ADMIN);
  await clearLockedCrawls();
  await seedLockedCrawl({
    ownerName: 'E2E Freight Skipper', eventDate: DATE, startTime: '12:00',
    departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z'
  });
  await page.clock.install({ time: new Date('2026-12-26T19:00:00.000Z') });
  let attempts = 0;
  await page.route('**/api/collections/media/records*', async (route) => {
    if (route.request().method() === 'POST' && ++attempts === 2) {
      await route.fulfill({ status: 503, json: { message: 'Temporary upload failure' } });
    } else {
      await route.continue();
    }
  });
  await page.goto('/live');
  await expect(page.getByTestId('action-photo')).toBeEnabled();
  await page.getByTestId('freight-input').setInputFiles(
    ['first.gif', 'middle.gif', 'last.gif'].map((name) => ({ name, mimeType: 'image/gif', buffer: GIF }))
  );
  await expect(page.getByRole('alert')).toHaveText(`2 ${copy.uploadSent} 1 ${copy.uploadNotSent} ${copy.uploadFailed}`);
  expect(attempts).toBe(3);
  await expect(page.getByTestId('freight-strip').locator('img')).toHaveCount(2);
  await expect(page.getByTestId('freight-input')).toBeEnabled();
});

for (const [phase, time] of [
  ['before', '2026-12-26T17:00:00.000Z'],
  ['after', '2026-12-26T22:00:00.000Z']
]) {
  test(`Freight stays closed ${phase} the crawl even though the board retains a stop`, async ({ page }) => {
    await page.route('**/api/metra/**', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
    await login(page, 'E2E Freight Skipper', ADMIN);
    await clearLockedCrawls();
    await seedLockedCrawl({
      ownerName: 'E2E Freight Skipper', eventDate: DATE, startTime: '12:00',
      departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z'
    });
    await page.clock.install({ time: new Date(time) });
    await page.goto('/live');

    await expect(page.getByRole('heading', { name: 'Tab', exact: true })).toBeVisible();
    await expect(page.getByTestId('no-active-route')).toHaveCount(0);
    await expect(page.getByTestId('freight-input')).toHaveCount(0);
  });
}
