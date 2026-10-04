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
  const crew = await (await browser.newContext()).newPage();
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
  await crew.context().close();
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
