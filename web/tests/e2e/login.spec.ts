import { test, expect } from '@playwright/test';

test('phone signup, persistent login, recovery, and logout on a mobile screen', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByTestId('to-signup').click();
  await page.getByTestId('phone').fill('312-555-0123');
  await page.getByTestId('send-code').click();
  await page.getByTestId('code').fill('111111');
  await page.getByTestId('pin').fill('2468');
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('error')).toBeVisible();
  await page.getByTestId('code').fill('000000');
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('name')).toHaveText('E2E Rider');
  await expect(page.getByTestId('role')).toHaveText('Crew');
  await page.reload();
  await expect(page.getByTestId('name')).toHaveText('E2E Rider');
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByTestId('phone').fill('312-555-0123');
  await page.getByTestId('pin').fill('0000');
  await page.getByTestId('login').click();
  await expect(page.getByTestId('error')).toBeVisible();
  await page.getByTestId('pin').fill('2468');
  await page.getByTestId('login').click();
  await expect(page.getByTestId('name')).toHaveText('E2E Rider');
  await page.getByTestId('logout').click();

  await page.getByTestId('to-signup').click();
  await page.getByTestId('phone').fill('312-555-0123');
  await page.getByTestId('send-code').click();
  await page.getByTestId('code').fill('000000');
  await page.getByTestId('pin').fill('9753');
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('name')).toHaveText('E2E Rider');
  await page.getByTestId('logout').click();
  await page.getByTestId('phone').fill('312-555-0123');
  await page.getByTestId('pin').fill('2468');
  await page.getByTestId('login').click();
  await expect(page.getByTestId('error')).toBeVisible();
  await page.getByTestId('pin').fill('9753');
  await page.getByTestId('login').click();
  await expect(page.getByTestId('name')).toHaveText('E2E Rider');
  await page.getByTestId('logout').click();
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('login')).toBeVisible();
});

test('shows an error for a phone outside the allowlist', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('to-signup').click();
  await page.getByTestId('phone').fill('3125550199');
  await page.getByTestId('send-code').click();
  await expect(page.getByTestId('error')).toContainText('crew list');
  await expect(page.getByTestId('code')).toHaveCount(0);
});
