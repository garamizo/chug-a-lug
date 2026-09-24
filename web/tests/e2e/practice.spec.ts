import { expect, test, type Page } from '@playwright/test';
import { PB, clearLockedCrawls, login, seedLockedCrawl, superuserToken } from './helpers';
import { copy } from '../../src/lib/labels';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';
// The fixture timetable covers 2026-10-26..12-31, so the route is dated in it and a practice day is
// any other day. 2026-12-19 13:00 CST practises the 26th's 13:00.
const PRACTICE = new Date('2026-12-19T19:00:00Z');

async function practise(page: Page, name: string) {
  await page.route('**/api/metra/alerts', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, alerts: [] } }));
  await login(page, name, ADMIN);
  await clearLockedCrawls();
  const ids = await seedLockedCrawl({ ownerName: name, eventDate: '2026-12-26', startTime: '12:00', departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: PRACTICE });
  return ids;
}

test('on a practice day Live runs the route at today’s time with timetable trains', async ({ page }) => {
  const next: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/metra/next')) next.push(r.url()); });
  await practise(page, 'E2E Practice Board');
  await page.goto('/');
  await expect(page.getByTestId('nav-live')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);                       // no event-day auto-landing
  await page.getByTestId('nav-live').click();
  await expect(page.getByTestId('practice-badge')).toHaveText(copy.practiceBadge);
  await expect(page.getByTestId('departure-board')).toBeVisible();
  await expect(page.getByTestId('strip-stop-0')).toHaveAttribute('aria-current', 'step');
  await expect.poll(() => next.find((u) => u.includes('practice=1') && u.includes('date=2026-12-26'))).toBeTruthy();
  await expect(page.getByTestId('tab-route')).toHaveCount(0); // TabBar is event-day only
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

test('yesterday’s activity is not on today’s Live', async ({ page }) => {
  const ids = await practise(page, 'E2E Yesterday');
  // A superuser backdates a chat line to yesterday. The server stamps real time, so write it directly.
  const token = await superuserToken();
  const user = (await (await fetch(`${PB}/api/collections/users/records?filter=${encodeURIComponent('name_key="e2e yesterday"')}`, { headers: { Authorization: token } })).json()).items[0];
  const post = (body: string, at?: string) => fetch(`${PB}/api/collections/chat_messages/records`, {
    method: 'POST', headers: { Authorization: token, 'content-type': 'application/json' },
    body: JSON.stringify({ itinerary: ids.itineraryId, user: user.id, body, ...(at ? { at } : {}) })
  });
  expect((await post('From yesterday', new Date(Date.now() - 86_400_000).toISOString())).ok).toBe(true);
  expect((await post('From today')).ok).toBe(true);
  await page.goto('/live');
  await expect(page.getByTestId('departure-board')).toBeVisible();
  await expect(page.getByText('From today')).toBeVisible();   // the feed has loaded
  await expect(page.getByText('From yesterday')).toHaveCount(0);
});
