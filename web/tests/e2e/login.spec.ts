import { test, expect } from '@playwright/test';

const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';
const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';

test('crew login by name and shared password persists in a cookie, then logs out', async ({ page, context }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByTestId('name-input').fill('E2E Rider');
  await page.getByTestId('password').fill('wrong password');
  await page.getByTestId('login').click();
  await expect(page.getByTestId('error')).toContainText('Wrong password');

  await page.getByTestId('password').fill(CREW);
  await page.getByTestId('login').click();
  await expect(page.getByTestId('name')).toHaveText('E2E Rider');
  await expect(page.getByTestId('role')).toHaveText('Crew');

  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === 'pb_auth')?.value).toBeTruthy();

  await page.reload();
  await expect(page.getByTestId('name')).toHaveText('E2E Rider');

  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).find((c) => c.name === 'pb_auth')).toBeUndefined();
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
});

test('admin password makes the name a Conductor', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('name-input').fill('e2e boss');
  await page.getByTestId('password').fill(ADMIN);
  await page.getByTestId('login').click();
  await expect(page.getByTestId('name')).toHaveText('e2e boss');
  await expect(page.getByTestId('role')).toHaveText('Conductor');
});
