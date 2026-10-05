import { test, expect, type Page } from '@playwright/test';
import { sessionFor, stubTurnstile } from './helpers';
import { copy, authCopy } from '../../src/lib/labels';

async function fillJoin(page: Page) {
  await page.getByTestId('name-input').fill('Alex Rider');
  await page.getByTestId('email-input').fill('typo@example.com');
  await page.getByTestId('password-input').fill('sample-password-1');
}

test('email correction retires the old request, keeps form values and ignores a stale poll', async ({ page }) => {
  await stubTurnstile(page);
  await page.clock.install();
  await page.route('**/api/crawl/join', r => r.fulfill({ json: { request_id: 'request1', secret: 'secret1' } }));
  let cancelled: unknown;
  await page.route('**/api/crawl/join/cancel', r => { cancelled = r.request().postDataJSON(); return r.fulfill({ json: {} }); });
  let release!: () => void, caught!: () => void;
  const held = new Promise<void>(r => release = r), polled = new Promise<void>(r => caught = r);
  await page.route('**/api/crawl/join/status', async r => { caught(); await held; await r.fulfill({ json: { status: 'unverified' } }); });
  await page.goto('/join'); await fillJoin(page);
  await page.getByTestId('send-code').click();
  await expect(page.getByTestId('code-input')).toBeVisible();
  await expect(page.getByTestId('code-input')).toBeFocused();
  await page.clock.runFor(5000); await polled;
  await page.getByTestId('change-email').click();
  await expect(page.getByTestId('email-input')).toHaveValue('typo@example.com');
  await expect(page.getByTestId('email-input')).toBeFocused();
  await expect(page.getByTestId('name-input')).toHaveValue('Alex Rider');
  await expect(page.getByTestId('password-input')).toHaveValue('sample-password-1');
  expect(cancelled).toEqual({ request_id: 'request1', secret: 'secret1' });
  const answered = page.waitForResponse('**/api/crawl/join/status'); release(); await answered;
  await expect(page.getByTestId('code-input')).toHaveCount(0);
  await page.getByTestId('email-input').fill('alex@example.com');
  const next = page.waitForRequest('**/api/crawl/join');
  await page.getByTestId('send-code').click();
  expect((await next).postDataJSON()).toMatchObject({ email: 'alex@example.com', name: 'Alex Rider' });
});

test('a failed correction keeps the request recoverable and a resend confirms success', async ({ page }) => {
  await stubTurnstile(page);
  await page.route('**/api/crawl/join', r => r.fulfill({ json: { request_id: 'request1', secret: 'secret1' } }));
  await page.route('**/api/crawl/join/status', r => r.fulfill({ json: { status: 'unverified' } }));
  await page.route('**/api/crawl/join/cancel', r => r.abort());
  await page.route('**/api/crawl/join/resend', r => r.fulfill({ json: {} }));
  await page.goto('/join'); await fillJoin(page); await page.getByTestId('send-code').click();
  await page.getByTestId('change-email').click();
  await expect(page.getByTestId('error')).toBeVisible();
  await expect(page.getByTestId('code-input')).toBeVisible();
  await page.getByTestId('resend-code').click();
  await expect(page.getByRole('status')).toContainText(authCopy.resent);
});

test('a typed email requests a sign-in code immediately and resend replaces its ID', async ({ page }) => {
  const addresses: string[] = []; let authenticated: unknown;
  await page.route('**/api/collections/users/request-otp', r => {
    addresses.push(r.request().postDataJSON().email);
    return r.fulfill({ json: { otpId: `otp${addresses.length}` } });
  });
  await page.route('**/api/collections/users/auth-with-otp', r => {
    authenticated = r.request().postDataJSON();
    return r.fulfill({ status: 400, json: { message: 'Test rejection' } });
  });
  await page.goto('/login');
  await page.getByTestId('email-input').fill('Alex@Example.com');
  await page.getByTestId('use-code').click();
  await expect(page.getByTestId('code-input')).toBeVisible();
  await expect(page.getByTestId('code-input')).toBeFocused();
  await page.getByTestId('resend-code').click();
  await expect(page.getByRole('status')).toContainText(authCopy.resent);
  await page.getByTestId('code-input').fill('123456');
  await page.getByTestId('sign-in').click();
  await expect(page.getByTestId('error')).toBeVisible();
  expect(addresses).toEqual(['alex@example.com', 'alex@example.com']);
  expect(authenticated).toEqual({ otpId: 'otp2', password: '123456' });
  await page.getByTestId('change-email').click();
  await expect(page.getByTestId('email-input')).toHaveValue('Alex@Example.com');
  await expect(page.getByTestId('email-input')).toBeFocused();
});

test('human-check script failure offers retry without losing typed details', async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/**', r => r.abort());
  await page.goto('/join'); await fillJoin(page);
  await expect(page.getByTestId('human-check-error')).toBeVisible();
  await expect(page.getByTestId('send-code')).toBeDisabled();
  await expect(page.getByTestId('send-code')).toHaveText(authCopy.continue);
  await stubTurnstile(page);
  await page.getByTestId('human-check-retry').click();
  await expect(page.getByTestId('send-code')).toBeEnabled();
  await expect(page.getByTestId('email-input')).toHaveValue('typo@example.com');
});

test('a silent human check times out and an expired token cannot submit', async ({ page }) => {
  await page.clock.install();
  await page.route('https://challenges.cloudflare.com/**', r => r.fulfill({ contentType: 'text/javascript', body:
    'window.turnstile={render:(el,o)=>{window.checkOptions=o;return "w"},reset:()=>{},remove:()=>{}};' }));
  await page.goto('/join');
  await page.waitForFunction(() => Boolean((window as any).checkOptions));
  await page.clock.runFor(16000);
  await expect(page.getByTestId('human-check-error')).toBeVisible();
  await page.getByTestId('human-check-retry').click();
  await page.evaluate(() => (window as any).checkOptions.callback('fresh-token'));
  await expect(page.getByTestId('send-code')).toBeEnabled();
  await page.evaluate(() => (window as any).checkOptions['expired-callback']());
  await expect(page.getByTestId('send-code')).toBeDisabled();
  await expect(page.getByTestId('human-check-retry')).toBeVisible();
});

async function googleReturn(page: Page, mode = 'join', state = 'good') {
  await page.goto('/login');
  await page.evaluate(({ mode }) => sessionStorage.setItem('chugalug_google', JSON.stringify({ mode, name: '', state: 'good', codeVerifier: 'v'.repeat(43), redirectUrl: location.origin + '/auth/google' })), { mode });
  await page.goto(`/auth/google?code=one-use-code&state=${state}`);
}

test('Google return collects the name before exchange, strips the URL and stores only a pending request', async ({ page }) => {
  let exchanges = 0, body: any;
  await page.route('**/api/collections/users/auth-with-oauth2', r => {
    exchanges++; body = r.request().postDataJSON();
    return r.fulfill({ status: 202, json: { pending: true, request_id: 'google1', secret: 'secret1' } });
  });
  await page.route('**/api/crawl/join/status', r => r.fulfill({ json: { status: 'waiting' } }));
  await googleReturn(page);
  await expect(page.getByRole('heading', { name: authCopy.profileTitle })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/google$/);
  expect(exchanges).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('chugalug_google'))).toBeNull();
  await page.getByTestId('name-input').fill('Alex / Rider');
  await page.getByTestId('request-join').click();
  await expect(page.getByTestId('error')).toHaveText(copy.nameError);
  expect(exchanges).toBe(0);
  await page.getByTestId('name-input').fill('Alex Rider');
  await page.getByTestId('request-join').click();
  await expect(page.getByTestId('waiting')).toBeVisible();
  expect(exchanges).toBe(1);
  expect(body).toMatchObject({ provider: 'google', code: 'one-use-code', createData: { name: 'Alex Rider' } });
  expect((await page.context().cookies()).some(c => c.name === 'pb_auth' && c.value !== '')).toBe(false);
});

test('invalid Google state makes no exchange and offers a clear return', async ({ page }) => {
  let exchanges = 0;
  page.on('request', r => { if (r.url().includes('/auth-with-oauth2')) exchanges++; });
  await googleReturn(page, 'join', 'wrong');
  await expect(page.getByTestId('error')).toBeVisible();
  await expect(page.getByRole('link', { name: copy.backToSignIn })).toBeVisible();
  await expect(page.getByRole('link', { name: authCopy.signUp, exact: true })).toBeVisible();
  expect(exchanges).toBe(0);
});

test('Google login exchanges once and a failed exchange has a fresh-start path', async ({ page }) => {
  let exchanges = 0;
  await page.route('**/api/collections/users/auth-with-oauth2', r => {
    exchanges++; return r.fulfill({ status: 400, json: { message: 'Expired code' } });
  });
  await googleReturn(page, 'login');
  await expect(page.getByTestId('error')).toContainText('Expired code');
  await expect(page.getByTestId('google-retry')).toBeVisible();
  expect(exchanges).toBe(1);
});


test('leaving a Google exchange preserves its pending request without navigating back', async ({ page }) => {
  let release!: () => void, caught!: () => void;
  const held = new Promise<void>(r => release = r), requested = new Promise<void>(r => caught = r);
  await page.route('**/api/collections/users/auth-with-oauth2', async r => {
    caught(); await held;
    await r.fulfill({ status: 202, json: { pending: true, request_id: 'late-google', secret: 'late-secret' } });
  });
  await googleReturn(page);
  await page.getByTestId('name-input').fill('Alex Rider');
  await page.getByTestId('request-join').click(); await requested;
  await page.getByRole('link', { name: copy.backToSignIn }).click();
  await expect(page).toHaveURL(/\/login$/);
  release();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('chugalug_boarding') ?? 'null')))
    .toMatchObject({ requestId: 'late-google', secret: 'late-secret', name: 'Alex Rider' });
  await expect(page).toHaveURL(/\/login$/);
});

test('reloading Google profile preserves signup intent and name for a fresh exchange', async ({ page }) => {
  let exchanges = 0;
  await page.route('**/api/collections/users/auth-with-oauth2', r => { exchanges++; return r.abort(); });
  await page.route('**/api/collections/users/auth-methods?*', r => r.fulfill({ json: {
    oauth2: { enabled: true, providers: [{ name: 'google', state: 'new-state', codeVerifier: 'new-verifier', authURL: `${new URL(page.url()).origin}/google-test?redirect_uri=` }] }
  } }));
  await page.route('**/google-test?*', r => r.fulfill({ contentType: 'text/html', body: '<p>Google consent</p>' }));
  await googleReturn(page);
  await page.getByTestId('name-input').fill('Alex Rider');
  await page.reload();
  await expect(page.getByTestId('google-retry')).toBeVisible();
  expect(exchanges).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('chugalug_google'))).toBeNull();
  await page.getByTestId('google-retry').click();
  await expect(page).toHaveURL(/\/google-test\?/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('chugalug_google') ?? 'null')))
    .toMatchObject({ mode: 'join', name: 'Alex Rider', state: 'new-state', codeVerifier: 'new-verifier' });
  expect(exchanges).toBe(0);
});

test('restoring a request never claims verification before the server confirms it', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => localStorage.setItem('chugalug_boarding', JSON.stringify({ requestId: 'saved', secret: 'secret', name: 'Alex', email: 'alex@example.com', savedAt: Date.now() })));
  let release!: () => void, caught!: () => void;
  const held = new Promise<void>(r => release = r), requested = new Promise<void>(r => caught = r);
  await page.route('**/api/crawl/join/status', async r => { caught(); await held; await r.abort(); });
  await page.goto('/join'); await requested;
  await expect(page.getByTestId('join-restoring')).toBeVisible();
  await expect(page.getByText(authCopy.verified, { exact: true })).toHaveCount(0);
  release();
  await expect(page.getByTestId('join-offline')).toBeVisible();
  await expect(page.getByTestId('waiting')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('chugalug_boarding'))).not.toBeNull();
  await page.unroute('**/api/crawl/join/status');
  await page.route('**/api/crawl/join/status', r => r.fulfill({ json: { status: 'unverified' } }));
  await page.getByTestId('retry-status').click();
  await expect(page.getByTestId('code-input')).toBeFocused();
});

test('password reset focuses the confirmation then the corrected email', async ({ page }) => {
  await page.route('**/api/collections/users/request-password-reset', r => r.fulfill({ status: 204 }));
  await page.goto('/login/forgot');
  await page.getByTestId('email-input').fill('alex@example.com');
  await page.getByTestId('send-link').click();
  await expect(page.getByRole('heading', { name: authCopy.inboxTitle })).toBeFocused();
  await page.getByTestId('change-email').click();
  await expect(page.getByTestId('email-input')).toBeFocused();
});


test('leaving a Google login exchange still saves the completed session', async ({ page }) => {
  const session = await sessionFor('E2E Google Late Session');
  let release!: () => void, caught!: () => void;
  const held = new Promise<void>(r => release = r), requested = new Promise<void>(r => caught = r);
  await page.route('**/api/collections/users/auth-with-oauth2', async r => {
    caught(); await held; await r.fulfill({ json: session });
  });
  await googleReturn(page, 'login'); await requested;
  await page.getByRole('link', { name: copy.backToSignIn }).click();
  await page.getByTestId('forgot').click();
  await expect(page).toHaveURL(/\/login\/forgot$/);
  release();
  await expect.poll(async () => {
    const cookie = (await page.context().cookies()).find(c => c.name === 'pb_auth');
    return cookie ? JSON.parse(decodeURIComponent(cookie.value)).token : null;
  }).toBe(session.token);
  await expect(page).toHaveURL(/\/login\/forgot$/);
});
