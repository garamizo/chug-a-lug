import { test, expect, type Page } from '@playwright/test';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';

const venuesFor: Record<string, unknown[]> = {
  ELMHURST: [{ source: 'osm', id: 'node/1', name: 'Test Tavern', kind: 'bar', lat: 41.9012, lon: -87.9412, distanceM: 120, address: '1 York St' }],
  WHEATON: [{ source: 'osm', id: 'node/2', name: 'Wheaton Wine Bar', kind: 'bar', lat: 41.864, lon: -88.106, distanceM: 90 }]
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
  await expect(page).toHaveURL(/\/plan\/[a-z0-9]{15}$/);
  const draftUrl = page.url();

  await page.getByTestId('add-stop').click();
  await page.getByTestId('station-ELMHURST').click();
  await page.getByTestId('venue-node-1').click();
  await expect(page).toHaveURL(draftUrl);
  await expect(page.getByTestId('stop-row-0')).toContainText('Test Tavern');
  await expect(page.getByTestId('stop-row-0')).toContainText('11:00 AM');

  await page.getByTestId('add-stop').click();
  await page.getByTestId('station-select').selectOption('WHEATON');
  await page.getByTestId('venue-node-2').click();
  await expect(page.getByTestId('stop-row-1')).toContainText('Wheaton Wine Bar');
  await expect(page.getByTestId('leg-0')).toContainText('UP-W');
  await expect(page.getByTestId('leg-0')).toContainText('1:10 PM');
  await expect(page.getByTestId('stop-row-1')).toContainText('1:32 PM');

  await page.getByTestId('dwell-0').fill('150');
  await page.getByTestId('dwell-0').press('Tab');
  await expect(page.getByTestId('leg-0')).toContainText('3:05 PM');

  await page.getByTestId('stop-link-0').click();
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

  await page.goto(draftUrl);
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
  await expect(page.getByTestId('stop-row-0')).toContainText('Test Tavern');
  await expect(page.getByTestId('leg-0')).toContainText('3:05 PM');
  await expect(page.getByTestId('locked-on')).toBeVisible();
  await expect(page.getByTestId('add-stop')).toHaveCount(0);
});
