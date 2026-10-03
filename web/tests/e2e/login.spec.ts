import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('a signed-out visitor lands on /login; a session persists in a cookie until logout', async ({ page, context }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await login(page, 'E2E Rider', 'crew-test-password');
  expect((await context.cookies()).find((c) => c.name === 'pb_auth')?.value).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId('name')).toHaveText('E2E Rider');
  await page.getByTestId('menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).find((c) => c.name === 'pb_auth')).toBeUndefined();
});
