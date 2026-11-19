import { expect, test, type Locator, type Page } from '@playwright/test';
import { clearRoutes, inviteLink, login, openTab, seedDraftRoute, seedLockedCrawl, settledOn, tapDrink } from './helpers';
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
  await sweep(page, [
    { name: 'login, password', open: (p) => p.goto('/login'), ready: (p) => p.getByTestId('password-input') },
    { name: 'forgot password', open: (p) => p.goto('/login/forgot'), ready: (p) => p.getByTestId('send-link') },
    { name: 'reset form', open: (p) => p.goto('/reset-password#layout-sweep'), ready: (p) => p.getByTestId('set-password') },
    { name: 'reset, dead link', open: (p) => p.goto('/reset-password'), ready: (p) => p.getByTestId('reset-dead') },
    { name: 'join, no link', open: (p) => p.goto('/join'), ready: (p) => p.getByTestId('join-no-link') },
    { name: 'join, checking', open: async (p) => { await p.route('**/api/crawl/join/link', () => {}); await p.goto('/join#' + 'c'.repeat(32)); }, ready: (p) => p.getByTestId('join-checking') },
    { name: 'join, dead link', open: async (p) => { await p.unroute('**/api/crawl/join/link'); await p.goto('/join#' + 'd'.repeat(32)); }, ready: (p) => p.getByTestId('join-dead') },
    { name: 'join, form', open: async (p) => { await p.goto('/login'); await p.goto(await inviteLink()); }, ready: (p) => p.getByTestId('send-code') },
    { name: 'join, code', open: async (p) => {
        await p.route('**/api/crawl/join', (r) => r.fulfill({ json: { signup_id: 'layout-signup', secret: 'layout-secret' } }));
        await p.getByTestId('name-input').fill('Alex Rider'); await p.getByTestId('email-input').fill('alex@example.com');
        await p.getByTestId('password-input').fill('layout-password'); await p.getByTestId('send-code').click();
      }, ready: (p) => p.getByTestId('code-input') },
    { name: 'join, stuck', open: async (p) => {
        await p.route('**/api/crawl/join/verify', (r) => r.fulfill({ status: 410, json: { message: 'That code expired. Start again.' } }));
        await p.getByTestId('code-input').fill('123456'); await p.getByTestId('verify').click();
      }, ready: (p) => p.getByTestId('start-again') },
    { name: 'join, maybe ready', open: async (p) => {
        await p.route('**/api/crawl/join/verify', (r) => r.fulfill({ status: 404, json: { message: 'nope' } }));
        await p.getByTestId('code-input').fill('123456'); await p.getByTestId('verify').click();
      }, ready: (p) => p.getByTestId('join-maybe-ready') }
  ]);
});

test('password recovery states', async ({ page }) => {
  await page.goto('/login');
  await page.route('**/api/collections/users/request-password-reset', r => r.fulfill({ status: 204 }));
  await page.route('**/api/collections/users/confirm-password-reset', r => r.fulfill({ status: 204 }));
  await sweep(page, [
    { name: 'reset email sent', open: async (p) => { await p.goto('/login/forgot'); await p.getByTestId('email-input').fill('alex@example.com'); await p.getByTestId('send-link').click(); }, ready: p => p.getByTestId('link-sent') },
    { name: 'password set', open: async (p) => { await p.goto('/reset-password#layout-token'); await p.getByTestId('password-input').fill('layout-password'); await p.getByTestId('set-password').click(); }, ready: p => p.getByTestId('password-set') }
  ]);
});

async function eventDay(page: Page, name: string, when = EVENT_DAY, startStation?: { id: string; name: string }) {
  await stubDepartures(page);
  await login(page, name, ADMIN);
  await clearRoutes();
  const ids = await seedLockedCrawl({ ownerName: name, eventDate: '2026-12-26', startTime: '12:00',
    departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z', extraVenueAtFirstStation: true, startStation });
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
      { name: 'live, Tab sending a proof', open: async (p) => {
          // The upload never answers; the next state unroutes it so later Freight uploads are not held.
          await p.route('**/collections/media/records', async (r) => { if (r.request().method() === 'POST') await new Promise(() => {}); else await r.continue(); });
          await openTab(p); await tapDrink(p, 'beer');
        }, ready: (p) => p.getByTestId('tab-sending-beer') },
      { name: 'live, Tab open', open: async (p) => { await p.unroute('**/collections/media/records'); await openTab(p); }, ready: (p) => p.getByTestId('drink-beer') },
      // The first shot of the day is this crew member's Pathfinder: their phone celebrates it over the Tab.
      { name: 'live, Golden Spike celebration', open: async (p) => { await openTab(p); await tapDrink(p, 'shot'); }, ready: (p) => p.getByTestId('spike-celebration') },
      // Escape dismisses the card, so it counts as seen: one cut short by the next page load would come back over it.
      { name: 'live, stop sheet', open: async (p) => {
          await p.keyboard.press('Escape'); await expect(p.getByTestId('spike-celebration')).toHaveCount(0);
          await p.goto(`/live?stop=${ids.secondStopId}`);
        }, ready: (p) => p.getByTestId('sheet-name') },
      // Lightbox stacks over StopSheet: two native modals, only the top one is checked.
      { name: 'live, photo over the stop sheet', open: (p) => openSheetPhoto(p), ready: (p) => p.getByTestId('lightbox') },
      // Mid-crawl the train home has not arrived: the reel's page says when it starts.
      { name: 'closing time, not yet', open: (p) => p.goto('/live/closing'), ready: (p) => p.getByTestId('reel-not-yet') },
      { name: 'route', open: (p) => p.goto('/route'), ready: (p) => p.getByTestId('locked-on') },
      { name: 'route, Tab open', open: (p) => openTab(p), ready: (p) => p.getByTestId('drink-beer') },
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

test('a route with a run home', async ({ page }) => {
  const ids = await eventDay(page, 'E2E Sweep Home', EVENT_DAY, { id: 'AURORA', name: 'Aurora' });
  await sweep(page, [
    { name: 'route view, run home', open: (p) => p.goto(`/plan/${ids.itineraryId}`), ready: (p) => p.getByTestId('closing-leg') }
  ]);
});

test('a draft with stops on both sides', async ({ page }) => {
  await stubDepartures(page);
  await login(page, 'E2E Sweep Sides', ADMIN);
  await clearRoutes();
  const { itineraryId } = await seedDraftRoute({ ownerName: 'E2E Sweep Sides', eventDate: '2026-12-26', startTime: '12:00', stops: [
    { name: 'Going Naperville', station_id: 'NAPERVILLE', station_name: 'Naperville', direction: 'out' },
    { name: 'Back One', station_id: 'NAPERVILLE', station_name: 'Naperville', direction: 'back' },
    { name: 'Back Two', station_id: 'NAPERVILLE', station_name: 'Naperville', direction: 'back', photo: true },
    { name: 'Back Three', station_id: 'NAPERVILLE', station_name: 'Naperville', direction: 'back' }
  ] });
  await sweep(page, [
    { name: 'draft editor, going side', open: (p) => p.goto(`/plan/${itineraryId}/edit`), ready: (p) => p.getByTestId('stop-row-0') },
    { name: 'draft editor, return side', open: async (p) => { await p.getByTestId('side-right').click(); await settledOn(p, 'right'); }, ready: (p) => p.getByTestId('stop-row-2') }
  ]);
});

test('Conductor pages', async ({ page }) => {
  const ids = await eventDay(page, 'E2E Sweep Conductor');
  await sweep(page, [
    { name: 'locked-route editor', open: (p) => p.goto(`/plan/${ids.itineraryId}/edit`), ready: (p) => p.getByTestId('save-plan') },
    { name: 'station picker', open: (p) => p.goto(`/plan/${ids.itineraryId}/add`), ready: (p) => p.getByTestId('station-select') },
    // The fixture has no nearby venues and the harness has no Places provider, so one is stubbed.
    { name: 'station picker, venue sheet', open: async (p) => {
        await p.route('**/api/places/nearby**', (r) => r.fulfill({ json: { station: { id: 'NAPERVILLE', name: 'NAPERVILLE', lat: 0, lon: 0 },
          venues: [{ source: 'osm', id: 'node/2', name: 'Naperville Wine Bar', kind: 'bar', lat: 41.7811, lon: -88.1467, distanceM: 91 }],
          fetchedAt: '2026-09-19T00:00:00.000Z' } }));
        await p.goto(`/plan/${ids.itineraryId}/add?station=NAPERVILLE&side=left`);
        await p.getByTestId('venue-node-2').click();
      }, ready: (p) => p.getByTestId('venue-sheet') },
    { name: 'crew access', open: async (p) => { await p.unroute('**/api/places/nearby**'); await p.goto('/crew/access'); }, ready: (p) => p.getByTestId('manifest-person') },
    { name: 'role window', open: async (p) => { await p.goto('/crew'); await p.getByTestId('crew-name-button').first().click(); }, ready: (p) => p.getByTestId('role-window') },
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
    { name: 'practice live', open: (p) => p.goto('/live'), ready: (p) => p.getByTestId('departure-board') },
    // The tab bar's other screens carry it on a practice day too.
    { name: 'practice route', open: (p) => p.goto('/route'), ready: (p) => p.getByTestId('tab-bar') },
    { name: 'practice crew board', open: (p) => p.goto('/crew'), ready: (p) => p.getByTestId('tab-bar') }
  ]);
});
