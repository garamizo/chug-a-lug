import { test, expect, type Page } from '@playwright/test';
import { clearMails, codeFor, inviteLink, PB, superuserToken } from './helpers';
import { authCopy } from '../../src/lib/labels';

const uid = () => Math.floor(Math.random() * 1e9);
const PASSWORD = 'join-test-password-1';

async function fillForm(page: Page, name: string, email: string) {
  await page.getByTestId('name-input').fill(name);
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(PASSWORD);
  await page.getByTestId('send-code').click();
}
async function enterCode(page: Page, email: string) {
  await page.getByTestId('code-input').fill(await codeFor(email));
  await page.getByTestId('verify').click();
}
async function usersWith(email: string): Promise<number> {
  const q = new URLSearchParams({ filter: `email=${JSON.stringify(email)}` });
  const r = await fetch(`${PB}/api/collections/users/records?${q}`, { headers: { Authorization: await superuserToken() } });
  return (await r.json()).items.length;
}

test('no link asks for the link; a dead link asks for a new one', async ({ page }) => {
  await page.goto('/join');
  await expect(page.getByTestId('join-no-link')).toHaveText(authCopy.noLink);
  await expect(page.getByTestId('name-input')).toHaveCount(0);
  // Pasted into the same tab: only the fragment changes, so the page has to notice.
  await page.goto('/join#' + 'Z'.repeat(32));
  await expect(page.getByTestId('join-dead')).toContainText(authCopy.linkDead);
  await page.goto('/login');
  await page.goto('/join#' + 'Y'.repeat(32));
  await expect(page.getByTestId('join-dead')).toContainText(authCopy.linkDead);
});

test('a rate-limited link check still shows the form, without an error', async ({ page }) => {
  await page.route('**/api/crawl/join/link', (route) => route.fulfill({ status: 429, json: { message: 'Too many tries. Try again in an hour.' } }));
  await page.goto('/join#' + 'r'.repeat(32));
  await expect(page.getByTestId('name-input')).toBeVisible();
  await expect(page.getByTestId('error')).toHaveCount(0);
});

test('a link signs up, lands on Home and stays signed in', async ({ page }) => {
  const n = uid(), name = `Join Rider ${n}`, email = `join${n}@test.invalid`;
  await clearMails();
  await page.goto(await inviteLink());
  await expect(page.getByTestId('name-input')).toBeVisible();
  expect(page.url()).not.toContain('#');
  await fillForm(page, name, email);
  await enterCode(page, email);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('name')).toHaveText(name);
  await page.reload();
  await expect(page.getByTestId('name')).toHaveText(name);
});

test('reloading on the code step keeps the sign-up', async ({ page }) => {
  const n = uid(), name = `Join Reload ${n}`, email = `reload${n}@test.invalid`;
  await clearMails();
  await page.goto(await inviteLink());
  await fillForm(page, name, email);
  await expect(page.getByTestId('code-input')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('code-input')).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await enterCode(page, email);
  await expect(page.getByTestId('name')).toHaveText(name);
});

test("the last seat's lost answer survives a reload", async ({ page }) => {
  const n = uid(), name = `Join Last ${n}`, email = `last${n}@test.invalid`;
  await clearMails();
  await page.goto(await inviteLink(1));
  await fillForm(page, name, email);
  await expect(page.getByTestId('code-input')).toBeVisible();
  const code = await codeFor(email);
  // The server commits (and takes the last seat), then the answer is lost, and so is the automatic retry.
  await page.route('**/api/crawl/join/verify', async (route) => { await route.fetch(); await route.abort(); });
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('error')).toBeVisible();
  await page.unroute('**/api/crawl/join/verify');
  await page.reload();
  await expect(page.getByTestId('code-input')).toBeVisible();
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('name')).toHaveText(name);
  expect(await usersWith(email)).toBe(1);
});

test('a lost verify answer is retried', async ({ page }) => {
  const n = uid(), name = `Join Retry ${n}`, email = `retry${n}@test.invalid`;
  await clearMails();
  await page.goto(await inviteLink());
  await fillForm(page, name, email);
  await expect(page.getByTestId('code-input')).toBeVisible();
  let calls = 0;
  await page.route('**/api/crawl/join/verify', (route) => (calls++ === 0 ? route.abort() : route.continue()));
  await enterCode(page, email);
  await expect(page.getByTestId('name')).toHaveText(name);

});

test('a verify answered 404 offers sign-in', async ({ page }) => {
  const m = uid(), email2 = `maybe${m}@test.invalid`;
  await clearMails();
  await page.goto(await inviteLink());
  await fillForm(page, `Join Maybe ${m}`, email2);
  await expect(page.getByTestId('code-input')).toBeVisible();
  await page.route('**/api/crawl/join/verify', (route) => route.fulfill({ status: 404, json: { message: 'nope' } }));
  await page.getByTestId('code-input').fill('123456');
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('join-maybe-ready')).toBeVisible();
  await expect(page.getByTestId('join-maybe-ready').getByRole('link')).toHaveAttribute('href', '/login');
});

test('an email with a seat is told to sign in', async ({ page: first, browser }) => {
  let page = first;
  const n = uid(), email = `seat${n}@test.invalid`;
  await clearMails();
  await page.goto(await inviteLink());
  await fillForm(page, `Join Seat ${n}`, email);
  await enterCode(page, email);
  await expect(page.getByTestId('name')).toBeVisible();
  // A second visitor: a fresh browser context, signed out.
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:15173' });
  page = await other.newPage();
  await page.goto(await inviteLink());
  await fillForm(page, `Join Seat Two ${n}`, email);
  await expect(page.getByTestId('error')).toHaveText('That email already has a seat. Sign in instead.');
});

test('Back from Sign in returns to the join page, with no token in the address bar', async ({ page }) => {
  await page.goto(await inviteLink());
  await expect(page.getByTestId('name-input')).toBeVisible();
  expect(page.url()).not.toContain('#');
  await page.getByRole('link', { name: 'Sign in' }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/join$/);
  await expect(page.getByTestId('name-input')).toBeVisible();
});

test('an expired code says so and starts again with the name and email kept', async ({ page }) => {
  const n = uid(), name = `Join Expired ${n}`, email = `expired${n}@test.invalid`;
  await clearMails();
  await page.goto(await inviteLink());
  await fillForm(page, name, email);
  await expect(page.getByTestId('code-input')).toBeVisible();
  await page.route('**/api/crawl/join/verify', (route) => route.fulfill({ status: 410, json: { message: 'That code expired. Start again.' } }));
  await page.getByTestId('code-input').fill('123456');
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('error')).toHaveText('That code expired. Start again.');
  await page.getByTestId('start-again').click();
  await expect(page.getByTestId('name-input')).toHaveValue(name);
  await expect(page.getByTestId('email-input')).toHaveValue(email);
  await page.reload();
  await expect(page.getByTestId('name-input')).toBeVisible();
  await expect(page.getByTestId('code-input')).toHaveCount(0);
});

test('a resend that works takes Start again away', async ({ page }) => {
  const n = uid(), email = `stuck${n}@test.invalid`;
  await clearMails();
  await page.goto(await inviteLink());
  await fillForm(page, `Join Stuck ${n}`, email);
  await expect(page.getByTestId('code-input')).toBeVisible();
  await page.route('**/api/crawl/join/verify', (route) => route.fulfill({ status: 410, json: { message: 'That code expired. Start again.' } }));
  await page.getByTestId('code-input').fill('123456');
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('start-again')).toBeVisible();
  await page.route('**/api/crawl/join/resend', (route) => route.fulfill({ json: {} }));
  await page.getByTestId('resend-code').click();
  await expect(page.getByText(authCopy.resent)).toBeVisible();
  await expect(page.getByTestId('start-again')).toHaveCount(0);
});
