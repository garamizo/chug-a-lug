import { test, expect } from '@playwright/test';
import { clearMails, codeFor, sessionFor, stubTurnstile } from './helpers';

test('a visitor boards by email, waits, is let aboard and signs in with a code', async ({ page }) => {
  const n = Math.floor(Math.random() * 1e6), email = `visitor${n}@test.invalid`;
  await clearMails(); await stubTurnstile(page);
  await page.goto('/login');
  await page.getByTestId('to-join').click();
  await page.getByTestId('name-input').fill(`Visitor ${n}`);
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('send-code').click();
  await page.getByTestId('code-input').fill(await codeFor(email));
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('waiting')).toBeVisible();

  // Reopening the page resumes the wait (Review Focus 3), even with no signal.
  await page.reload();
  await expect(page.getByTestId('waiting')).toBeVisible();
  await page.route('**/api/crawl/join/status', (route) => route.abort());
  await page.reload();
  await expect(page.getByTestId('join-offline')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('waiting')).toBeVisible();
  await page.unroute('**/api/crawl/join/status');

  // A crew member answers through the API here; the popup UI is Task 8's spec.
  const crew = await sessionFor(`E2E Voucher ${n}`);
  const pb = process.env.PB_URL ?? 'http://127.0.0.1:18093';
  const list = await (await fetch(`${pb}/api/collections/boarding_requests/records?filter=${encodeURIComponent(`email="${email}"`)}`, { headers: { Authorization: crew.token } })).json();
  expect((await fetch(`${pb}/api/crawl/boarding/${list.items[0].id}/let-aboard`, { method: 'POST', headers: { Authorization: crew.token } })).status).toBe(200);

  await expect(page.getByTestId('aboard')).toBeVisible({ timeout: 10_000 });
  await clearMails();
  await page.getByTestId('go-sign-in').click();
  await page.getByTestId('email-input').fill(email.toUpperCase());
  await page.getByTestId('send-code').click();
  await page.getByTestId('code-input').fill(await codeFor(email));
  await page.getByTestId('sign-in').click();
  await expect(page.getByTestId('name')).toHaveText(`Visitor ${n}`);
});
