import { expect, test } from '@playwright/test';
import { clearLockedCrawls, login, seedLockedCrawl } from './helpers';

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

  await page.getByTestId('action-tab').click();
  const beer = page.getByTestId('drink-beer');
  await expect(beer).toContainText('0');
  await beer.click();
  await expect(beer).toContainText('1');

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
