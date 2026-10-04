import { test, expect } from '@playwright/test';
import { clearMails, codeFor, login, resetLinkFor, sessionFor } from './helpers';
import { copy } from '../../src/lib/labels';

const uid = () => Math.floor(Math.random() * 1e6);
const emailOf = (name: string) => `${Buffer.from(name.toLowerCase()).toString('hex')}@test.invalid`;

test('signs in with email and password; a wrong one says so; Show reveals it', async ({ page }) => {
  const name = `Pw Rider ${uid()}`;
  await sessionFor(name);
  await page.goto('/login');
  await page.getByTestId('email-input').fill(emailOf(name).toUpperCase());
  await page.getByTestId('password-input').fill('wrong-password-1');
  await page.getByTestId('password-sign-in').click();
  await expect(page.getByTestId('error')).toHaveText(copy.passwordMismatch);
  await page.getByTestId('password-input').fill('seed-test-password-1');
  await page.getByTestId('password-input-show').click();
  await expect(page.getByTestId('password-input')).toHaveAttribute('type', 'text');
  await page.getByTestId('password-sign-in').click();
  await expect(page.getByTestId('name')).toHaveText(name);
});

test('forgot password: the link sets a new one and signs in, without leaving the token in the address bar', async ({ page }) => {
  const name = `Pw Forgetful ${uid()}`, email = emailOf(name);
  await sessionFor(name); await clearMails();
  await page.goto('/login');
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('forgot').click();
  await expect(page).toHaveURL(/\/login\/forgot$/);
  await expect(page.getByTestId('email-input')).toHaveValue(email);
  await page.getByTestId('send-link').click();
  await expect(page.getByTestId('link-sent')).toHaveText(copy.linkMaybeSent);
  await page.goto(await resetLinkFor(email));
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByTestId('password-input').fill('brand-new-pass-1');
  await page.getByTestId('set-password').click();
  await expect(page.getByTestId('name')).toHaveText(name);
});

test('a dead reset link says so and offers a new one', async ({ page }) => {
  await page.goto('/reset-password#not-a-real-token');
  await page.getByTestId('password-input').fill('brand-new-pass-1');
  await page.getByTestId('set-password').click();
  await expect(page.getByTestId('reset-dead')).toHaveText(copy.resetLinkDead);
  await expect(page.getByRole('link', { name: copy.askNewLink })).toHaveAttribute('href', '/login/forgot');
});

test('a mangled reset link is dead at once, and the fragment is gone', async ({ page }) => {
  await page.goto('/reset-password#%E0%A4%A');
  await expect(page.getByTestId('reset-dead')).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
});

test('email me a code instead still signs in', async ({ page }) => {
  const name = `Pw Coder ${uid()}`, email = emailOf(name);
  await sessionFor(name); await clearMails();
  await page.goto('/login');
  await page.getByTestId('use-code').click();
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('send-code').click();
  await page.getByTestId('code-input').fill(await codeFor(email));
  await page.getByTestId('sign-in').click();
  await expect(page.getByTestId('name')).toHaveText(name);
});

test('Your ticket emails a link to set a password', async ({ page }) => {
  const name = `Pw Ticket ${uid()}`, email = emailOf(name);
  await clearMails();
  await login(page, name, 'crew-test-password');
  await page.goto('/account');
  await page.getByTestId('account-password-link').click();
  await expect(page.getByTestId('account-note')).toHaveText(`${copy.linkSentTo} ${email}`);
  expect(await resetLinkFor(email)).toContain('/reset-password#');
});
