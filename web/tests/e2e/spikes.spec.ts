import { expect, test, type Page } from '@playwright/test';
import { clearRoutes, login, openTab, seedLockedCrawl, tapDrink } from './helpers';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';
const EVENT_DAY = new Date('2026-12-26T19:00:00Z');

async function openLive(page: Page) {
  await page.route('**/api/metra/**', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  await page.clock.install({ time: EVENT_DAY });
  await page.goto('/live');
  await expect(page.getByTestId('departure-board')).toBeVisible();
}

test('a Golden Spike posts to everyone, and only the winner sees it celebrated, once', async ({ page, browser }) => {
  await login(page, 'E2E Spike Watcher', ADMIN);
  await clearRoutes();
  await seedLockedCrawl({ ownerName: 'E2E Spike Watcher', eventDate: '2026-12-26', startTime: '12:00',
    departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await openLive(page);
  const context = await browser.newContext();
  try {
    const winner = await context.newPage();
    await login(winner, 'E2E Spike Winner', CREW);
    await openLive(winner);
    await openTab(winner);
    await tapDrink(winner, 'beer');

    const line = (p: Page) => p.getByTestId('crew-chat').locator('article.spike').filter({ hasText: 'Pathfinder · E2E Spike Winner' });
    await expect(winner.getByTestId('spike-celebration')).toBeVisible();
    await expect(winner.getByTestId('spike-celebration')).toContainText('Pathfinder');
    await expect(winner.getByTestId('spike-celebration')).toContainText('First to log it today');
    await expect(line(winner)).toBeVisible();
    await expect(line(page)).toBeVisible();
    // The watcher's phone has the line; give its overlay the time it would have needed, then check none came.
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('spike-celebration')).toHaveCount(0);

    await winner.reload();
    await expect(line(winner)).toBeVisible();
    await winner.waitForTimeout(1500);
    await expect(winner.getByTestId('spike-celebration')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
