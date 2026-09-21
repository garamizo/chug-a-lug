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
