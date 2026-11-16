import { expect, test, type Page } from '@playwright/test';
import { clearRoutes, login, seedLockedCrawl } from './helpers';
import { copy } from '../../src/lib/labels';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
// Mid-crawl on the event day: the train home has not arrived, so there is no Closing Time yet.
// The reel itself plays in the simulation suite (tests/sim/closing.spec.ts), which moves the server's clock.
const EVENT_DAY = new Date('2026-12-26T19:00:00Z');

test('before Closing Time the reel says when it starts, links back to Live, and nothing from the app sits over it', async ({ page }) => {
  await page.route('**/api/metra/**', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
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

  // Back to Live leaves the way ✕ does: the reel's entry becomes Live, so Back goes on to the screen before.
  await reel.getByRole('link', { name: copy.backToLive }).click();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('departure-board')).toBeVisible();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/route$/);

  await page.goForward();
  await expect(page).toHaveURL(/\/live$/);
  // ✕ on a reel entered directly has no Live behind it: it replaces itself with Live.
  await page.goto('/live/closing');
  await page.getByTestId('reel-close').click();
  await expect(page).toHaveURL(/\/live$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('closing-reel')).toHaveCount(0);
  expect(errors).toEqual([]);
});

/** An in-app link to `href`, clicked inside `within`: stands in for Live's Play and for any link out of the reel. */
async function follow(page: Page, within: string, href: string) {
  await page.evaluate(([sel, to]) => {
    const a = document.createElement('a');
    a.href = to; a.textContent = 'follow'; a.dataset.testid = 'follow';
    document.querySelector(sel)!.append(a);
  }, [within, href]);
  await page.getByTestId('follow').click();
}

test('✕ goes back only when Live is behind the reel, and always leaves', async ({ page }) => {
  await page.route('**/api/metra/**', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'E2E Closing Leave', ADMIN);
  await clearRoutes();
  await seedLockedCrawl({ ownerName: 'E2E Closing Leave', eventDate: '2026-12-26', startTime: '12:00',
    departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: EVENT_DAY });

  // Opened from Live: ✕ is Back, so Live's own history is untouched.
  await page.goto('/route');
  await page.goto('/live');
  await expect(page.getByTestId('departure-board')).toBeVisible();
  await follow(page, 'main', '/live/closing');
  await expect(page.getByTestId('closing-reel')).toBeVisible();
  await page.getByTestId('reel-close').dblclick();
  await expect(page).toHaveURL(/\/live$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/route$/);

  // Entered directly, left for Live by a link, then Back into the reel: Live is ahead of it, not behind,
  // so ✕ must not go back (to /route) but replace itself with Live.
  await page.goto('/live/closing');
  await expect(page.getByTestId('closing-reel')).toBeVisible();
  await follow(page, '[data-testid="closing-reel"]', '/live');
  await expect(page.getByTestId('departure-board')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('closing-reel')).toBeVisible();
  await page.getByTestId('reel-close').click();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('departure-board')).toBeVisible();
  await expect(page.getByTestId('closing-reel')).toHaveCount(0);
  expect(errors).toEqual([]);
});
