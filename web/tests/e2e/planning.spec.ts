import { test, expect, type Page } from '@playwright/test';
import { clearLockedCrawls, seedLockedCrawl } from './helpers';
import { copy } from '../../src/lib/labels';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';

// Both venues are about 100 m from their BNSF station (a 2-minute walk).
const venuesFor: Record<string, unknown[]> = {
  LAGRANGE: [{ source: 'google', id: 'p1', name: 'Test Tavern', kind: 'bar', lat: 41.8155, lon: -87.8694, distanceM: 118, address: '1 Burlington Ave', rating: 4.6, ratingCount: 312 }],
  NAPERVILLE: [{ source: 'osm', id: 'node/2', name: 'Naperville Wine Bar', kind: 'bar', lat: 41.7811, lon: -88.1467, distanceM: 91 }]
};

async function login(page: Page, name: string, password: string) {
  await page.goto('/login');
  await page.getByTestId('name-input').fill(name);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('login').click();
  await expect(page.getByTestId('name')).toHaveText(name);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/places/nearby**', (route) => {
    const station = new URL(route.request().url()).searchParams.get('station') ?? '';
    return route.fulfill({ json: { station: { id: station, name: station, lat: 0, lon: 0 }, venues: venuesFor[station] ?? [], fetchedAt: '2026-09-19T00:00:00.000Z' } });
  });
  await page.route('**/api/places/attach', (route) => route.fulfill({ status: 503, json: { message: 'Google Places is not configured on the server.' } }));
  await page.route('**/api/places/search**', (route) => route.fulfill({ json: { venues: [] } }));
});

test('draft with real train times, layover change, card edits, votes, comments, approval and lock', async ({ page }) => {
  await login(page, 'E2E Skipper', ADMIN);
  await page.getByTestId('nav-plan').click();
  await page.getByTestId('draft-title').fill('E2E Crawl');
  await page.getByTestId('create-draft').click();
  // A new draft opens on its edit screen; the view screen is one level up.
  await expect(page).toHaveURL(/\/plan\/[a-z0-9]{15}\/edit$/);
  const editUrl = page.url();
  const draftUrl = editUrl.replace(/\/edit$/, '');

  // Tapping a station circle on the draft opens the picker with that station and direction chosen.
  await page.getByTestId('station-dot-NAPERVILLE').click();
  await expect(page).toHaveURL(/\/add\?station=NAPERVILLE&side=left$/);
  await expect(page.getByTestId('dir-out')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('venue-node-2').click();
  await expect(page).toHaveURL(editUrl);
  await expect(page.getByTestId('stop-row-0')).toContainText('Naperville Wine Bar');
  await expect(page.getByTestId('stop-row-0')).toContainText('11:00 AM');

  // The picker itself offers only the BNSF line, Aurora first and Union Station last.
  await page.goto(`${draftUrl}/add`);
  await expect(page.getByTestId('station-ELMHURST')).toHaveCount(0);
  await expect(page.getByTestId('station-select').locator('option')).toHaveText(['Pick a station', 'Naperville', 'La Grange Road', 'Chicago Union Station']);
  await page.getByTestId('station-select').selectOption('LAGRANGE');
  await expect(page.getByTestId('venue-p1')).toContainText('★ 4.6 (312)');
  await page.getByTestId('venue-p1').click();
  await expect(page.getByTestId('stop-row-1')).toContainText('Test Tavern');
  await expect(page.getByTestId('leg-0')).toContainText('BNSF');
  await expect(page.getByTestId('leg-0')).toContainText('12:05 PM');
  await expect(page.getByTestId('stop-row-1')).toContainText('12:32 PM');
  // Both are going stops, each in its station's row of the outbound half.
  await expect(page.getByTestId('map-row-NAPERVILLE').getByTestId('stop-row-0')).toHaveAttribute('data-side', 'left');
  await expect(page.getByTestId('map-row-LAGRANGE').getByTestId('stop-row-1')).toHaveAttribute('data-side', 'left');

  // A circle tapped on the way-back half makes a return stop, slotted after the going stops.
  await expect(page.getByTestId('section-back')).toBeVisible();
  await page.getByTestId('station-dot-back-NAPERVILLE').click();
  await expect(page).toHaveURL(/side=right$/);
  await expect(page.getByTestId('dir-back')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('venue-node-2').click();
  await expect(page.getByTestId('map-row-back-NAPERVILLE').getByTestId('stop-row-2')).toHaveAttribute('data-side', 'right');
  await expect(page.getByTestId('map-row-NAPERVILLE').getByTestId('stop-row-2')).toHaveCount(0);
  await expect(page.getByTestId('stop-row-1')).toContainText('Test Tavern');
  // And a going stop added afterwards still lands among the going stops, before the return ones.
  await page.goto(`${draftUrl}/add?station=LAGRANGE&side=left`);
  await page.getByTestId('venue-p1').click();
  await expect(page.getByTestId('map-row-LAGRANGE').getByTestId('stop-row-2')).toHaveAttribute('data-side', 'left');
  await expect(page.getByTestId('map-row-back-NAPERVILLE').getByTestId('stop-row-3')).toHaveAttribute('data-side', 'right');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('remove-2').click();
  await expect(page.getByTestId('stop-row-3')).toHaveCount(0);

  // The departure is chosen by train: arrive 11:00, 2 min walk, so the 2:05 PM train is a 3 h 3 min layover.
  await expect(page.getByTestId('dwell-0').locator('option')).toContainText(['1 h layover (current)', '12:05 PM · 1 h 3 min layover', '2:05 PM · 3 h 3 min layover']);
  await page.getByTestId('dwell-0').selectOption('183');
  await expect(page.getByTestId('leg-0')).toContainText('2:05 PM');
  await expect(page.getByTestId('stop-row-0')).toContainText('Leave 2:03 PM');

  await page.getByTestId('stop-link-1').click();
  await expect(page.getByTestId('stop-name')).toHaveText('Test Tavern');
  await expect(page.getByTestId('photos-status')).toContainText('No photos yet');
  await page.getByTestId('retry-photos').click();
  await expect(page.getByTestId('photos-status')).toContainText('not configured');
  await page.getByTestId('notes').fill('Ask for Gus');
  await page.getByTestId('confirmed-open').check();
  await page.getByTestId('confirm-phone').fill('630-555-0100');
  await page.getByTestId('save-stop').click();
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  await page.reload();
  await expect(page.getByTestId('notes')).toHaveValue('Ask for Gus');
  await expect(page.getByTestId('confirmed-open')).toBeChecked();

  // The view screen: read-only route, cheers, comments and the Highball; no edit controls.
  await page.goto(editUrl);
  await page.getByTestId('done-editing').click();
  await expect(page).toHaveURL(draftUrl);
  await expect(page.getByTestId('delete-route')).toBeVisible();
  await expect(page.locator('header.it')).toContainText('by E2E Skipper');
  await expect(page.locator('header.it')).toContainText('stops');
  await expect(page.getByTestId('station-dot-LAGRANGE')).toHaveCount(0);
  await expect(page.getByTestId('station-dot-back-LAGRANGE')).toHaveCount(0);
  await expect(page.getByTestId('dwell-0')).toHaveCount(0);
  await expect(page.getByTestId('stop-row-0')).toContainText('3 h 3 min layover');
  await page.getByTestId('vote-up').click();
  await expect(page.getByTestId('vote-up-count')).toHaveText('1');
  await page.getByTestId('comment-input').fill('Nice route');
  await page.getByTestId('comment-post').click();
  await expect(page.getByTestId('comments')).toContainText('Nice route');
  await expect(page.getByTestId('comments')).toContainText('E2E Skipper');

  await page.getByTestId('open-vote').click();
  await page.getByTestId('vote-go').click();
  await expect(page.getByTestId('tally')).toContainText('E2E Skipper');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('lock-route').click();
  await expect(page).toHaveURL(/\/route$/);
  await expect(page.getByRole('heading', { name: 'E2E Crawl' })).toBeVisible();
  await expect(page.getByTestId('stop-row-1')).toContainText('Test Tavern');
  await expect(page.getByTestId('leg-0')).toContainText('2:05 PM');
  await expect(page.getByTestId('locked-on')).toBeVisible();
  await expect(page.getByTestId('station-dot-LAGRANGE')).toHaveCount(0);
  await expect(page.getByTestId('station-dot-back-LAGRANGE')).toHaveCount(0);
  await expect(page.getByTestId('remove-0')).toHaveCount(0);
  await expect(page.getByTestId('dwell-0')).toHaveCount(0);
});

test('another crew member can read and cheer a draft but not change it, even by deep link', async ({ page, browser }) => {
  await login(page, 'E2E Builder', process.env.CREW_PASSWORD ?? 'crew-test-password');
  await page.getByTestId('nav-plan').click();
  await page.getByTestId('draft-title').fill('Builder Only');
  await page.getByTestId('create-draft').click();
  await expect(page).toHaveURL(/\/plan\/[a-z0-9]{15}\/edit$/);
  const draftUrl = page.url().replace(/\/edit$/, '');

  const other = await browser.newPage();
  await login(other, 'E2E Onlooker', process.env.CREW_PASSWORD ?? 'crew-test-password');
  await other.goto(draftUrl);
  await expect(other.getByTestId('vote-up')).toBeVisible();
  await expect(other.getByTestId('edit-draft')).toHaveCount(0);
  await expect(other.getByTestId('delete-route')).toHaveCount(0);
  await other.goto(`${draftUrl}/edit`);
  await expect(other).toHaveURL(draftUrl);
  await other.goto(`${draftUrl}/add?station=NAPERVILLE&side=left`);
  await expect(other).toHaveURL(draftUrl);
  await other.close();
});

test('the builder deletes their draft from the board with the trash icon', async ({ page }) => {
  await login(page, 'E2E Tidy', process.env.CREW_PASSWORD ?? 'crew-test-password');
  await page.getByTestId('nav-plan').click();
  await page.getByTestId('draft-title').fill('Short Lived');
  await page.getByTestId('create-draft').click();
  await expect(page).toHaveURL(/\/edit$/);
  const id = page.url().match(/plan\/([a-z0-9]{15})/)![1];
  await page.goto('/plan');
  await expect(page.getByTestId(`route-link-${id}`)).toContainText(/short lived/i);
  await expect(page.getByTestId(`route-link-${id}`).locator('..')).toContainText('by E2E Tidy');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId(`delete-route-${id}`).click();
  await expect(page.getByTestId(`route-link-${id}`)).toHaveCount(0);
});

test('the Conductor deletes a locked route for everyone from its view page', async ({ page }) => {
  await login(page, 'E2E Deleter', ADMIN);
  await clearLockedCrawls();
  const seeded = await seedLockedCrawl({
    ownerName: 'E2E Deleter', eventDate: '2026-12-26', startTime: '12:00',
    departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z'
  });
  await page.goto(`/plan/${seeded.itineraryId}`);
  let dialogMessage = '';
  page.once('dialog', (d) => { dialogMessage = d.message(); void d.accept(); });
  await page.getByTestId('delete-route').click();
  await expect(page).toHaveURL(/\/plan$/);
  expect(dialogMessage).toContain(copy.deleteLockedConfirm.split('?')[0]);
  await expect(page.getByTestId(`route-link-${seeded.itineraryId}`)).toHaveCount(0);
});
