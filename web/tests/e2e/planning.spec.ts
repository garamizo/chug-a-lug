import { test, expect, type Page } from '@playwright/test';

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
  // Both are going stops: left of the line, each in its station's row.
  await expect(page.getByTestId('map-row-NAPERVILLE').getByTestId('stop-row-0')).toHaveAttribute('data-side', 'left');
  await expect(page.getByTestId('map-row-LAGRANGE').getByTestId('stop-row-1')).toHaveAttribute('data-side', 'left');

  // A circle tapped on the return pane makes a return stop, slotted after the going stops.
  await page.getByTestId('side-right').click();
  await expect(page.getByTestId('side-right')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('station-dot-NAPERVILLE').click();
  await expect(page).toHaveURL(/side=right$/);
  await expect(page.getByTestId('dir-back')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('venue-node-2').click();
  await expect(page.getByTestId('map-row-NAPERVILLE').getByTestId('stop-row-2')).toHaveAttribute('data-side', 'right');
  await expect(page.getByTestId('stop-row-1')).toContainText('Test Tavern');
  // And a going stop added afterwards still lands among the going stops, before the return ones.
  await page.goto(`${draftUrl}/add?station=LAGRANGE&side=left`);
  await page.getByTestId('venue-p1').click();
  await expect(page.getByTestId('map-row-LAGRANGE').getByTestId('stop-row-2')).toHaveAttribute('data-side', 'left');
  await expect(page.getByTestId('map-row-NAPERVILLE').getByTestId('stop-row-3')).toHaveAttribute('data-side', 'right');
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
  await expect(page.getByTestId('station-dot-LAGRANGE')).toHaveCount(0);
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
  await expect(page.getByTestId('remove-0')).toHaveCount(0);
  await expect(page.getByTestId('dwell-0')).toHaveCount(0);
});
