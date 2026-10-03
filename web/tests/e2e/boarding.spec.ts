import { test, expect } from '@playwright/test';
import { clearMails, codeFor, login, sessionFor, stubTurnstile } from './helpers';

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

test('crew get a popup; when one approver answers, the other popup clears; put off ends a session', async ({ browser }) => {
  // Realtime normally delivers in a second or two; the queue's 30 s reconciliation is the fallback,
  // so every popup wait allows 35 s.
  test.setTimeout(150_000);
  const n = Math.floor(Math.random() * 1e6), email = `popup${n}@test.invalid`;
  const boss = await browser.newContext(), mate = await browser.newContext(), guest = await browser.newContext();
  const [b, m, g] = await Promise.all([boss.newPage(), mate.newPage(), guest.newPage()]);
  await login(b, `E2E Chief ${n}`, 'admin-test-password');
  await login(m, `E2E Mate ${n}`, 'crew-test-password');

  await clearMails(); await stubTurnstile(g);
  await g.goto('/join');
  await g.getByTestId('name-input').fill(`Popup ${n}`);
  await g.getByTestId('email-input').fill(email);
  await g.getByTestId('send-code').click();
  await g.getByTestId('code-input').fill(await codeFor(email));
  await g.getByTestId('verify').click();

  await expect(b.getByTestId('boarding-popup')).toContainText(`Popup ${n}`, { timeout: 35_000 });
  await expect(m.getByTestId('boarding-popup')).toContainText(`Popup ${n}`, { timeout: 35_000 });
  await b.getByTestId('boarding-popup').getByTestId('let-aboard').click();
  await expect(m.getByTestId('boarding-popup')).toHaveCount(0, { timeout: 35_000 });
  await expect(g.getByTestId('aboard')).toBeVisible({ timeout: 10_000 });

  await b.goto('/crew/access');
  await b.getByTestId('manifest-person').filter({ hasText: `E2E Mate ${n}` }).getByTestId('toggle-block').click();
  await m.reload();
  await expect(m).toHaveURL(/\/login$/);
  await Promise.all([boss.close(), mate.close(), guest.close()]);
});
