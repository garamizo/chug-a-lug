import { expect, test, type Page } from '@playwright/test';
import { PB, clearRoutes, login, seedLockedCrawl, superuserToken, openTab } from './helpers';
import { copy } from '../../src/lib/labels';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';
// The fixture timetable covers 2026-10-26..12-31, so the route is dated in it and a practice day is
// any other day. 2026-12-19 13:00 CST practises the 26th's 13:00.
const PRACTICE = new Date('2026-12-19T19:00:00Z');

/** The mirrored route's id, or null if nothing is stored — read straight from IndexedDB so a
 *  stale mirror after a delete cannot be missed (see `$lib/offline.ts`: DB `chugalug`, store
 *  `mirror`, key `route`). */
async function mirroredRouteId(page: Page): Promise<string | null> {
  return page.evaluate(() => new Promise<string | null>((resolve, reject) => {
    const request = indexedDB.open('chugalug', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('mirror')) { db.close(); resolve(null); return; }
      const tx = db.transaction('mirror', 'readonly');
      const read = tx.objectStore('mirror').get('route');
      tx.oncomplete = () => { db.close(); resolve((read.result as { itinerary?: { id: string } } | undefined)?.itinerary?.id ?? null); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

async function practise(page: Page, name: string) {
  await page.route('**/api/metra/alerts', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, alerts: [] } }));
  await login(page, name, ADMIN);
  await clearRoutes();
  const ids = await seedLockedCrawl({ ownerName: name, eventDate: '2026-12-26', startTime: '12:00', departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: PRACTICE });
  return ids;
}

test('on a practice day Live runs the route at today’s time with timetable trains, showing only today’s activity', async ({ page }) => {
  const next: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/metra/next')) next.push(r.url()); });
  const ids = await practise(page, 'E2E Practice Board');
  // Yesterday's activity is not on today's Live. A superuser backdates a chat line to yesterday:
  // the server stamps real time, so it is written directly.
  const token = await superuserToken();
  const user = (await (await fetch(`${PB}/api/collections/users/records?filter=${encodeURIComponent('name_key="e2e practice board"')}`, { headers: { Authorization: token } })).json()).items[0];
  const post = (body: string, at?: string) => fetch(`${PB}/api/collections/chat_messages/records`, {
    method: 'POST', headers: { Authorization: token, 'content-type': 'application/json' },
    body: JSON.stringify({ itinerary: ids.itineraryId, user: user.id, body, ...(at ? { at } : {}) })
  });
  expect((await post('From yesterday', new Date(Date.now() - 86_400_000).toISOString())).ok).toBe(true);
  expect((await post('From today')).ok).toBe(true);
  await page.goto('/');
  await expect(page.getByTestId('nav-live')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);                       // no event-day auto-landing
  await page.getByTestId('nav-live').click();
  await expect(page.getByTestId('practice-badge')).toHaveText(copy.practiceBadge);
  await expect(page.getByTestId('departure-board')).toBeVisible();
  await expect(page.getByTestId('strip-stop-0')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByText('From today')).toBeVisible();   // the feed has loaded
  await expect(page.getByText('From yesterday')).toHaveCount(0);
  await expect.poll(() => next.find((u) => u.includes('practice=1') && u.includes('date=2026-12-26'))).toBeTruthy();
  // Live carries the tab bar on a practice day so the Tab can be opened; practice drinks count.
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await openTab(page);
  await page.getByTestId('drink-beer').click();
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('1');
  // Other screens stay practice-free: no tab bar off Live.
  await page.goto('/plan');
  await expect(page.getByTestId('tab-bar')).toHaveCount(0);
});

test('a practice Bulletin pins on Live but not on the planner', async ({ page }) => {
  await practise(page, 'E2E Practice Bulletin');
  await page.goto('/live');
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-bulletin').click();
  await page.getByTestId('bulletin-body').fill('Practice: meet at the clock.');
  await page.getByTestId('bulletin-send').click();
  await expect(page.getByTestId('pinned-bulletin')).toBeVisible();
  // In-app navigation keeps the loaded live day, so the Bulletin and the banner would show at once.
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-plan').click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.getByTestId('pinned-bulletin')).toHaveCount(0);
  await expect(page.getByTestId('banner')).toHaveCount(0);
  // Nothing is hidden for good: the day's Bulletins are still listed.
  await page.goto('/notifications');
  await expect(page.getByTestId('bulletin-list')).toContainText('Practice: meet at the clock.');
});

test('the Conductor makes a route current and another phone’s Live follows it', async ({ page, browser }) => {
  const first = await practise(page, 'E2E Make Current');
  // Locked later, so it is the newest-locked fallback until the Conductor chooses.
  await seedLockedCrawl({ ownerName: 'E2E Make Current', eventDate: '2026-12-12', startTime: '12:00', departAt: '2026-12-12T20:34:00Z', arriveAt: '2026-12-12T20:49:00Z', firstStopName: 'The Switchyard' });
  const crew = await (await browser.newContext()).newPage();
  await crew.route('**/api/metra/alerts', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, alerts: [] } }));
  // Hold the crew phone's train reads for the first route, so a late answer would land after the switch.
  let held: (() => void) | undefined;
  await crew.route('**/api/metra/next**', async (r) => { if (!held) { await new Promise<void>((go) => { held = go; }); } await r.continue(); });
  await login(crew, 'E2E Make Current Crew', CREW);
  await crew.clock.install({ time: PRACTICE });
  await crew.goto('/live');
  await expect(crew.getByText('The Switchyard').first()).toBeVisible();

  await page.goto(`/plan/${first.itineraryId}`);
  await page.getByTestId('make-current').click();
  await expect(page.getByTestId('current-route')).toBeVisible();

  await expect(crew.getByText('The Whistle Stop').first()).toBeVisible();
  await expect(crew.getByText('The Switchyard')).toHaveCount(0);
  held?.();                                                  // the old route's trains answer now
  await expect(crew.getByTestId('departure-board')).toBeVisible();
  await expect(crew.getByText('The Switchyard')).toHaveCount(0);
  await crew.context().close();
});

test('a watcher falls back after the Conductor deletes the current route', async ({ page, browser }) => {
  const ids = await practise(page, 'E2E Delete Current');
  const crew = await (await browser.newContext()).newPage();
  await crew.route('**/api/metra/alerts', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, alerts: [] } }));
  await login(crew, 'E2E Delete Current Crew', CREW);
  await crew.clock.install({ time: PRACTICE });
  await crew.goto('/live');
  await expect(crew.getByTestId('departure-board')).toBeVisible();
  // The offline mirror is saved once the route has loaded, so it can be checked after the delete.
  await expect.poll(() => mirroredRouteId(crew)).toBe(ids.itineraryId);

  await page.goto('/plan');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId(`delete-route-${ids.itineraryId}`).click();
  await expect(page.getByTestId(`route-link-${ids.itineraryId}`)).toHaveCount(0);

  // The crew phone's own `itineraries`/`crawl_settings` subscriptions pick up the delete without
  // a reload — no locked route is left, so Live falls back to "no active route", not the deleted
  // route's title.
  await expect(crew.getByTestId('no-active-route')).toBeVisible({ timeout: 10_000 });
  await expect(crew.getByText('The Whistle Stop')).toHaveCount(0);

  // The mirror must not resurrect the deleted route on a later offline reload: `clearMirror` drops
  // it once the authoritative read comes back empty. This harness has no service worker in dev
  // mode, so a real `setOffline` reload cannot load the app shell; read the mirror directly instead.
  await expect.poll(() => mirroredRouteId(crew)).toBeNull();
  await crew.close();
});
