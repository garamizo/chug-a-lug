import { expect, test } from '@playwright/test';
import { clearRoutes, login, seedLockedCrawl } from './helpers';
import { copy } from '../../src/lib/labels';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
// Mid-crawl on the event day: the train home has not arrived, so there is no Closing Time yet.
// The reel itself plays in the simulation suite (tests/sim/closing.spec.ts), which moves the server's clock.
const EVENT_DAY = new Date('2026-12-26T19:00:00Z');

test('before Closing Time the reel says when it starts, links back to Live, and nothing from the app sits over it', async ({ page }) => {
  await page.route('**/api/metra/**', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  await login(page, 'E2E Closing Early', ADMIN);
  await clearRoutes();
  await seedLockedCrawl({ ownerName: 'E2E Closing Early', eventDate: '2026-12-26', startTime: '12:00',
    departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: EVENT_DAY });

  // A Bulletin to pin, posted from Live, and the event day's chrome on another screen.
  await page.goto('/live');
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-bulletin').click();
  await page.getByTestId('bulletin-body').fill('Meet at the clock.');
  await page.getByTestId('bulletin-send').click();
  await expect(page.getByTestId('pinned-bulletin')).toBeVisible();
  await page.goto('/route');
  await expect(page.getByTestId('banner')).toBeVisible();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await expect(page.getByTestId('pinned-bulletin')).toBeVisible();

  // Direct entry: a full-screen dialog of its own, with no banner, Bulletin or tab bar.
  await page.goto('/live/closing');
  const reel = page.getByTestId('closing-reel');
  await expect(reel).toBeVisible();
  await expect(reel).toHaveAttribute('aria-modal', 'true');
  await expect(reel).toContainText(copy.closingNotYet);
  await expect(page.getByTestId('banner')).toHaveCount(0);
  await expect(page.getByTestId('tab-bar')).toHaveCount(0);
  await expect(page.getByTestId('pinned-bulletin')).toHaveCount(0);
  await expect(page.getByTestId('reel-loading')).toHaveCount(0);

  await reel.getByRole('link', { name: copy.backToLive }).click();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('departure-board')).toBeVisible();
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  // ✕ on a reel entered directly has no Live behind it: it replaces itself with Live.
  await page.goto('/live/closing');
  await page.getByTestId('reel-close').click();
  await expect(page).toHaveURL(/\/live$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('closing-reel')).toHaveCount(0);
});
