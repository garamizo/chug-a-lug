import { login as loginNamed, clearLockedCrawls, seedLockedCrawl } from './helpers';
import { test, expect, type Page } from '@playwright/test';

const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByTestId('name-input').fill('E2E Desk');
  await page.getByTestId('password').fill(CREW);
  await page.getByTestId('login').click();
  await expect(page.getByTestId('name')).toHaveText('E2E Desk');
}

test('desktop viewports get a wider column, still capped for readability', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  const box = await page.locator('main').boundingBox();
  expect(box?.width).toBeGreaterThan(600);
  expect(box?.width).toBeLessThan(1000);
});

test('the header with icon, title and menu stays pinned while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 300 });
  await login(page);
  const header = page.getByRole('banner');
  await expect(header.locator('img')).toBeVisible();
  await expect(header.getByText('Chug-a-Lug Choo-Choo')).toBeVisible();
  await expect(header.getByTestId('menu')).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const box = await header.boundingBox();
  expect(box?.y).toBe(0);
  await expect(header.getByTestId('menu')).toBeInViewport();
});

test('the header carries no date: the phone already shows one', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('banner')).not.toContainText(/Sat|Sun|Mon|Dec/);
});

test('the menu holds logout, opens the Crew Board, and keeps the Drink scoreboard visible but disabled', async ({ page }) => {
  await login(page);
  await page.getByTestId('menu').click();
  await expect(page.getByTestId('logout')).toBeVisible();
  const scoreboard = page.getByRole('button', { name: /Drink scoreboard/ });
  await expect(scoreboard).toBeVisible();
  await expect(scoreboard).toBeDisabled();

  const crewBoard = page.getByRole('button', { name: 'Crew Board', exact: true });
  await expect(crewBoard).toBeVisible();
  await expect(crewBoard).toBeEnabled();
  await crewBoard.click();
  await expect(page).toHaveURL(/\/crew$/);
  await expect(page.getByRole('heading', { name: 'Crew Board', exact: true })).toBeVisible();
  await expect(page.getByTestId('crew-row').filter({ hasText: 'E2E Desk' })).toBeVisible();
});

test('the menu is not offered before signing in', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('banner').getByText('Chug-a-Lug Choo-Choo')).toBeVisible();
  await expect(page.getByTestId('menu')).toHaveCount(0);
  await expect(page.getByTestId('logout')).toHaveCount(0);
});

test('normal mode hides simulation status and Conductor navigation', async ({ page }) => {
  await loginNamed(page, 'E2E Normal Conductor', process.env.ADMIN_PASSWORD!);
  await expect(page.getByTestId('simulation-status')).toHaveCount(0);
  await page.getByTestId('menu').click();
  await expect(page.getByRole('button', { name: 'Shakedown Run' })).toHaveCount(0);
});

test('on the event day the app lands on Live and navigates by the tab bar', async ({ page }) => {
  await page.route('**/api/metra/**', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  await loginNamed(page, 'E2E Tab Bar', process.env.ADMIN_PASSWORD ?? 'admin-test-password');
  await clearLockedCrawls();
  await seedLockedCrawl({ ownerName: 'E2E Tab Bar', eventDate: '2026-12-26', startTime: '12:00', departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
  await page.goto('/');
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('tab-live')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('tab-crew').click();
  await expect(page).toHaveURL(/\/crew$/);
  await expect(page.getByRole('link', { name: /Back to Live/ })).toHaveCount(0);
  await page.getByTestId('tab-menu').click();
  await expect(page.getByTestId('menu-crew')).toBeVisible();
});

test('off the event day there is no tab bar and home stays home', async ({ page }) => {
  await loginNamed(page, 'E2E No Tab Bar', process.env.ADMIN_PASSWORD ?? 'admin-test-password');
  await clearLockedCrawls();
  await seedLockedCrawl({ ownerName: 'E2E No Tab Bar', eventDate: '2026-12-26', startTime: '12:00', departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: new Date('2026-12-20T19:00:00Z') });
  await page.goto('/');
  await expect(page.getByTestId('name')).toBeVisible();
  await expect(page.getByTestId('tab-bar')).toHaveCount(0);
});
