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

test('the header with icon, title and logout stays pinned while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 300 });
  await login(page);
  const header = page.getByRole('banner');
  await expect(header.locator('img')).toBeVisible();
  await expect(header.getByText('Chug-a-Lug Choo-Choo')).toBeVisible();
  await expect(header.getByTestId('logout')).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const box = await header.boundingBox();
  expect(box?.y).toBe(0);
  await expect(header.getByTestId('logout')).toBeInViewport();
});

test('logout is not offered before signing in', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('banner').getByText('Chug-a-Lug Choo-Choo')).toBeVisible();
  await expect(page.getByTestId('logout')).toHaveCount(0);
});
