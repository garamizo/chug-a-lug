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
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`watcher: ${e.message}`));
  const context = await browser.newContext();
  try {
    const winner = await context.newPage();
    winner.on('pageerror', (e) => errors.push(`winner: ${e.message}`));
    await login(winner, 'E2E Spike Winner', CREW);
    await openLive(winner);
    await openTab(winner);
    await tapDrink(winner, 'beer');

    const overlay = winner.getByTestId('spike-celebration');
    const line = (p: Page) => p.getByTestId('crew-chat').locator('article.spike').filter({ hasText: 'Pathfinder · E2E Spike Winner — first 🍺' });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('Pathfinder');
    await expect(overlay).toContainText('First to log it today');
    // The card takes its own tap: it closes, and nothing underneath hears it.
    await winner.getByTestId('spike-card').click();
    await expect(overlay).toHaveCount(0);
    await expect(winner.getByTestId('tab-sheet')).toBeVisible();
    await expect(winner.getByTestId('drink-beer').locator('.count')).toHaveText('1');
    await expect(winner.getByTestId('tab-total')).toHaveText('1');

    await expect(line(winner)).toBeVisible();
    await expect(line(page)).toBeVisible();
    // The watcher's phone has the line; give its overlay the time it would have needed, then check none came.
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('spike-celebration')).toHaveCount(0);

    // Escape closes the card, not the Tab under it.
    await tapDrink(winner, 'shot');
    await expect(overlay).toBeVisible();
    await winner.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    await expect(winner.getByTestId('tab-sheet')).toBeVisible();

    // Outside the card, the page works as usual while the card shows.
    await tapDrink(winner, 'water');
    await expect(overlay).toBeVisible();
    await winner.getByTestId('tab-close').click({ timeout: 500 });
    await expect(winner.getByTestId('tab-sheet')).toBeHidden();

    await winner.reload();
    await expect(line(winner)).toBeVisible();
    await winner.waitForTimeout(1500);
    await expect(overlay).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
