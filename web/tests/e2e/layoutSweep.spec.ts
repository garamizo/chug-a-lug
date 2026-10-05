import { expect, test, type Locator, type Page } from '@playwright/test';
import { clearRoutes, login, openTab, seedLockedCrawl, stubTurnstile } from './helpers';
import { expectSaneLayout, type LayoutRule } from './layoutRules';
import { copy } from '../../src/lib/labels';

// Every page and page state, at the suite's phone viewport (iPhone 13). A new page or state gets one
// line here. `skip` takes rules a page legitimately breaks, each with a reason in a comment.
type State = { name: string; open: (page: Page) => Promise<unknown>; ready: (page: Page) => Locator; skip?: LayoutRule[] };

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';
const EVENT_DAY = new Date('2026-12-26T19:00:00Z');
const PRACTICE_DAY = new Date('2026-12-20T19:00:00Z');

/** Live departures only; /api/metra/stations stays real because the station picker reads its lines. */
async function stubDepartures(page: Page) {
  await page.route(/\/api\/metra\/(next|status|alerts)/, (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
}

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Shares a photo at the current stop, opens that stop's sheet and the photo: Lightbox over StopSheet (liveUx.spec.ts L70). */
async function openSheetPhoto(page: Page) {
  await page.goto('/live');
  await page.getByTestId('freight-input').setInputFiles({ name: 'bar.gif', mimeType: 'image/gif', buffer: GIF });
  await expect(page.getByTestId('freight-open-0')).toBeVisible();
  await page.getByTestId('route-strip').locator('[aria-current="step"]').click();
  await page.getByTestId('stop-sheet').locator('.gallery button').first().click();
}

async function sweep(page: Page, states: State[]) {
  for (const s of states) {
    await test.step(s.name, async () => {
      await s.open(page);
      await expect(s.ready(page).first()).toBeVisible();
      await expectSaneLayout(page, s.skip);
    });
  }
}

test('signed-out pages', async ({ page }) => {
  await stubTurnstile(page);
  await sweep(page, [
    { name: 'login, password', open: (p) => p.goto('/login'), ready: (p) => p.getByTestId('password-input') },
    { name: 'login, code', open: (p) => p.getByTestId('use-code').click(), ready: (p) => p.getByTestId('send-code') },
    { name: 'forgot password', open: (p) => p.goto('/login/forgot'), ready: (p) => p.getByTestId('send-link') },
    { name: 'reset form', open: (p) => p.goto('/reset-password#layout-sweep'), ready: (p) => p.getByTestId('set-password') },
    { name: 'reset, dead link', open: (p) => p.goto('/reset-password'), ready: (p) => p.getByTestId('reset-dead') },
    { name: 'join', open: (p) => p.goto('/join'), ready: (p) => p.getByTestId('send-code') }
  ]);
});

test('authentication recovery and approval states', async ({ page }) => {
  await stubTurnstile(page);
  await page.goto('/login');
  await page.route('**/api/collections/users/request-otp', r => r.fulfill({ json: { otpId: 'layout-otp' } }));
  await page.route('**/api/collections/users/auth-with-otp', r => r.fulfill({ status: 400, json: { message: copy.codeError } }));
  await page.route('**/api/collections/users/request-password-reset', r => r.fulfill({ status: 204 }));
  await page.route('**/api/collections/users/confirm-password-reset', r => r.fulfill({ status: 204 }));
  let status = 'unverified', offline = false;
  const pending: (() => void)[] = [];
  await page.route('**/api/crawl/join/status', async r => {
    if (status === 'loading') await new Promise<void>(resolve => pending.push(resolve));
    await (offline ? r.abort() : r.fulfill({ json: { status } }));
  });
  async function boarding(next: string, noSignal = false) {
    status = next; offline = noSignal;
    pending.splice(0).forEach(resolve => resolve());
    await page.evaluate(() => localStorage.setItem('chugalug_boarding', JSON.stringify({ requestId: 'layout-request', secret: 'layout-secret', name: 'Alex Rider', email: 'alex@example.com', savedAt: Date.now() })));
    await page.goto('/join');
  }
  async function google(mode: 'join' | 'login') {
    await page.evaluate((mode) => sessionStorage.setItem('chugalug_google', JSON.stringify({ mode, name: '', state: 'layout-state', codeVerifier: 'v'.repeat(43), redirectUrl: location.origin + '/auth/google' })), mode);
    await page.goto('/auth/google?state=layout-state&code=layout-code');
  }
  await sweep(page, [
    { name: 'sign-in code entry', open: async (p) => { await p.getByTestId('email-input').fill('alex@example.com'); await p.getByTestId('use-code').click(); }, ready: p => p.getByTestId('code-input') },
    { name: 'sign-in code error', open: async (p) => { await p.getByTestId('code-input').fill('123456'); await p.getByTestId('sign-in').click(); }, ready: p => p.getByTestId('error') },
    { name: 'sign-in code resent', open: p => p.getByTestId('resend-code').click(), ready: p => p.getByRole('status') },
    { name: 'reset email sent', open: async (p) => { await p.goto('/login/forgot'); await p.getByTestId('email-input').fill('alex@example.com'); await p.getByTestId('send-link').click(); }, ready: p => p.getByTestId('link-sent') },
    { name: 'password set', open: async (p) => { await p.goto('/reset-password#layout-token'); await p.getByTestId('password-input').fill('layout-password'); await p.getByTestId('set-password').click(); }, ready: p => p.getByTestId('password-set') },
    { name: 'join restoring', open: () => boarding('loading'), ready: p => p.getByTestId('join-restoring') },
    { name: 'join code entry', open: () => boarding('unverified'), ready: p => p.getByTestId('code-input') },
    { name: 'join awaiting approval', open: () => boarding('waiting'), ready: p => p.getByTestId('waiting') },
    { name: 'join offline', open: () => boarding('waiting', true), ready: p => p.getByTestId('join-offline') },
    { name: 'join approved', open: () => boarding('aboard'), ready: p => p.getByTestId('aboard') },
    { name: 'join declined', open: () => boarding('turned_away'), ready: p => p.getByTestId('turned-away') },
    { name: 'join expired', open: () => boarding('expired'), ready: p => p.getByTestId('expired') },
    { name: 'human check failed', open: async (p) => { await p.evaluate(() => localStorage.removeItem('chugalug_boarding')); await p.route('https://challenges.cloudflare.com/**', r => r.abort()); await p.goto('/join'); }, ready: p => p.getByTestId('human-check-error') },
    { name: 'Google crew name', open: () => google('join'), ready: p => p.getByTestId('request-join') },
    { name: 'Google profile reload', open: p => p.reload().then(() => {}), ready: p => p.getByTestId('google-retry') },
    { name: 'Google callback error', open: async (p) => { await p.route('**/api/collections/users/auth-with-oauth2', r => r.fulfill({ status: 400, json: { message: copy.genericError } })); await google('login'); }, ready: p => p.getByTestId('google-retry') }
  ]);
});

async function eventDay(page: Page, name: string, when = EVENT_DAY) {
  await stubDepartures(page);
  await login(page, name, ADMIN);
  await clearRoutes();
  const ids = await seedLockedCrawl({ ownerName: name, eventDate: '2026-12-26', startTime: '12:00',
    departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z', extraVenueAtFirstStation: true });
  await page.clock.install({ time: when });
  return ids;
}

test('crew pages on the event day', async ({ page, browser }) => {
  const ids = await eventDay(page, 'E2E Sweep Owner');
  const context = await browser.newContext();
  const crew = await context.newPage();
  try {
    await stubDepartures(crew);
    await crew.clock.install({ time: EVENT_DAY });
    await login(crew, 'E2E Sweep Crew', CREW);
    await sweep(crew, [
      { name: 'live', open: (p) => p.goto('/live'), ready: (p) => p.getByTestId('departure-board') },
      { name: 'live, Tab open', open: (p) => openTab(p), ready: (p) => p.getByTestId('drink-beer') },
      { name: 'live, stop sheet', open: (p) => p.goto(`/live?stop=${ids.secondStopId}`), ready: (p) => p.getByTestId('sheet-name') },
      // Lightbox stacks over StopSheet: two native modals, only the top one is checked.
      { name: 'live, photo over the stop sheet', open: (p) => openSheetPhoto(p), ready: (p) => p.getByTestId('lightbox') },
      { name: 'route', open: (p) => p.goto('/route'), ready: (p) => p.getByTestId('locked-on') },
      { name: 'crew board', open: (p) => p.goto('/crew'), ready: (p) => p.getByTestId('crew-row') },
      { name: 'notifications', open: (p) => p.goto('/notifications'), ready: (p) => p.getByRole('heading', { name: copy.bulletins }) },
      { name: 'account', open: (p) => p.goto('/account'), ready: (p) => p.getByTestId('account-save') },
      { name: 'plan list', open: (p) => p.goto('/plan'), ready: (p) => p.getByTestId('draft-title') },
      // current-route renders only for admins; crew see the stops.
      { name: 'route view', open: (p) => p.goto(`/plan/${ids.itineraryId}`), ready: (p) => p.getByText('The Whistle Stop') },
      { name: 'stop page', open: (p) => p.goto(`/plan/${ids.itineraryId}/stops/${ids.firstStopId}`), ready: (p) => p.getByTestId('notes') }
    ]);
  } finally {
    await context.close();
  }
});

test('Conductor pages', async ({ page }) => {
  const ids = await eventDay(page, 'E2E Sweep Conductor');
  await sweep(page, [
    { name: 'locked-route editor', open: (p) => p.goto(`/plan/${ids.itineraryId}/edit`), ready: (p) => p.getByTestId('save-plan') },
    { name: 'station picker', open: (p) => p.goto(`/plan/${ids.itineraryId}/add`), ready: (p) => p.getByTestId('station-select') },
    { name: 'crew access', open: (p) => p.goto('/crew/access'), ready: (p) => p.getByTestId('manifest-person') },
    { name: 'draft editor', open: async (p) => {
        await p.goto('/plan');
        await p.getByTestId('draft-title').fill(`Sweep Draft ${Date.now()}`);
        await p.getByTestId('create-draft').click();
        await expect(p).toHaveURL(/\/plan\/[a-z0-9]{15}\/edit$/);
      }, ready: (p) => p.getByTestId('route-title') }
  ]);
});

test('Live on a practice day', async ({ page }) => {
  await eventDay(page, 'E2E Sweep Practice', PRACTICE_DAY);
  await sweep(page, [
    { name: 'practice live', open: (p) => p.goto('/live'), ready: (p) => p.getByTestId('departure-board') }
  ]);
});
