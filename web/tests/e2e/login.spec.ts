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

test('login only signs in: the next page opened is already signed in, and an open page picks up the new session', async ({ page }) => {
  await login(page, 'E2E Cookie Only', 'crew-test-password');
  expect(page.url()).toBe('about:blank');
  await page.goto('/account');
  await expect(page.getByTestId('account-name')).toHaveValue('E2E Cookie Only');

  // A second login on a page that already runs the app: login reloads it, so the app re-reads the
  // cookie. Asserted before any navigation of our own, so it fails if login stops reloading.
  await login(page, 'E2E Cookie Second', 'crew-test-password');
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId('account-name')).toHaveValue('E2E Cookie Second');
});
