import { test, expect } from '@playwright/test';
import { PB, clearMails, codeFor, login, sessionFor, stubTurnstile, superuserToken } from './helpers';
import { copy } from '../../src/lib/labels';

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

test('a status poll answered after the code is confirmed cannot send the page back to the code step', async ({ page }) => {
  const n = Math.floor(Math.random() * 1e6), email = `poller${n}@test.invalid`;
  await clearMails(); await stubTurnstile(page);
  await page.goto('/join');
  await page.getByTestId('name-input').fill(`Poller ${n}`);
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('send-code').click();
  await expect(page.getByTestId('code-input')).toBeVisible();
  // Google is off in e2e: the hint offers only another code, and the button confirms, not signs in.
  await expect(page.getByText(copy.noCodeHintNoGoogle)).toBeVisible();
  await expect(page.getByTestId('verify')).toHaveText(copy.confirmCode);
  // Catch the next 5 s poll and hold it until the code is confirmed; then answer with the old state.
  let release!: () => void, caught!: () => void;
  const held = new Promise<void>((r) => (release = r)), polled = new Promise<void>((r) => (caught = r));
  await page.route('**/api/crawl/join/status', async (route) => {
    caught(); await held;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'unverified' }) });
  }, { times: 1 });
  await polled;
  await page.getByTestId('code-input').fill(await codeFor(email));
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('waiting')).toBeVisible();
  const answered = page.waitForResponse('**/api/crawl/join/status');
  release();
  await answered;
  await page.waitForTimeout(500);
  // Checked once, not retried: the next real poll would answer 'waiting' and hide a flip.
  expect(await page.getByTestId('code-input').count()).toBe(0);
  expect(await page.getByTestId('waiting').isVisible()).toBe(true);
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

  // The header dot shows while someone waits to board (spec §5); nobody is waiting yet.
  await truncateWaiting();
  await b.reload();
  await expect(b.getByTestId('menu')).toBeVisible();
  await expect(b.getByTestId('menu-dot')).toHaveCount(0);
  await clearMails(); await stubTurnstile(g);
  await g.goto('/join');
  await g.getByTestId('name-input').fill(`Popup ${n}`);
  await g.getByTestId('email-input').fill(email);
  await g.getByTestId('send-code').click();
  await g.getByTestId('code-input').fill(await codeFor(email));
  await g.getByTestId('verify').click();

  await expect(b.getByTestId('boarding-popup')).toContainText(`Popup ${n}`, { timeout: 35_000 });
  await expect(b.getByTestId('menu-dot')).toBeVisible();
  await expect(m.getByTestId('boarding-popup')).toContainText(`Popup ${n}`, { timeout: 35_000 });
  await b.getByTestId('boarding-popup').getByTestId('let-aboard').click();
  await expect(m.getByTestId('boarding-popup')).toHaveCount(0, { timeout: 35_000 });
  await expect(g.getByTestId('aboard')).toBeVisible({ timeout: 10_000 });

  await b.goto('/crew/access');
  const mateRow = b.getByTestId('manifest-person').filter({ hasText: `E2E Mate ${n}` });
  await expect(mateRow.getByTestId('person-status')).toContainText(copy.personAboard);
  await mateRow.getByTestId('toggle-block').click();
  await expect(mateRow.getByTestId('person-status')).toContainText(copy.personPutOff);
  await m.reload();
  await expect(m).toHaveURL(/\/login$/);
  // A failed Let back on is reported, and the Manifest stays on screen.
  await b.route('**/api/crawl/users/*/let-back-on', (route) => route.abort());
  await mateRow.getByTestId('toggle-block').click();
  await expect(b.getByTestId('manifest-action-error')).toHaveText(copy.noSignal);
  await expect(mateRow).toBeVisible();
  await expect(mateRow.getByTestId('person-status')).toContainText(copy.personPutOff);
  await b.unroute('**/api/crawl/users/*/let-back-on');
  await Promise.all([boss.close(), mate.close(), guest.close()]);
});

/** Expires every waiting request (superuser), so the header dot starts from an empty queue. */
async function truncateWaiting() {
  const su = await superuserToken();
  const list = await (await fetch(`${PB}/api/collections/boarding_requests/records?perPage=500&filter=${encodeURIComponent("status='waiting'")}`, { headers: { Authorization: su } })).json();
  for (const r of list.items ?? []) await fetch(`${PB}/api/collections/boarding_requests/records/${r.id}`, { method: 'PATCH', headers: { Authorization: su, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'expired' }) });
}
