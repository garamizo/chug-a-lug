import { expect, test, type Page } from '@playwright/test';
import { clearLockedCrawls, login, seedLockedCrawl } from './helpers';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

async function liveDay(page: Page, name: string) {
  await page.route('**/api/metra/**', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  await login(page, name, ADMIN);
  await clearLockedCrawls();
  const ids = await seedLockedCrawl({ ownerName: name, eventDate: '2026-12-26', startTime: '12:00', departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
  await page.goto('/live');
  await expect(page.getByTestId('departure-board')).toBeVisible();
  return ids;
}

test('a Freight photo opens in the viewer and back closes it without leaving Live', async ({ page }) => {
  await liveDay(page, 'E2E Lightbox');
  await page.getByTestId('freight-input').setInputFiles({ name: 'bar.gif', mimeType: 'image/gif', buffer: GIF });
  await page.getByTestId('freight-open-0').click();
  await expect(page.getByTestId('lightbox')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('lightbox')).toBeHidden();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('departure-board')).toBeVisible();
});
