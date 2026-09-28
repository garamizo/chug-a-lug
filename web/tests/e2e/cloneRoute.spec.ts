import { test, expect, type Page } from '@playwright/test';
import { login, seedLockedCrawl, clearLockedCrawls } from './helpers';
import { copy } from '../../src/lib/labels';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';
const RUN = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await page.route('**/api/places/nearby**', (route) => route.fulfill({ json: {
    station: { id: 'NAPERVILLE', name: 'NAPERVILLE', lat: 0, lon: 0 }, fetchedAt: '2026-09-19T00:00:00.000Z',
    venues: [{ source: 'osm', id: 'node/2', name: 'Naperville Wine Bar', kind: 'bar', lat: 41.7811, lon: -88.1467, distanceM: 91 }] } }));
  await page.route('**/api/places/attach', (route) => route.fulfill({ status: 503, json: { message: 'Google Places is not configured on the server.' } }));
  await page.route('**/api/places/photos', (route) => route.fulfill({ json: { status: 'none', place: null } }));
});

async function makeDraft(page: Page, title: string) {
  await page.getByTestId('nav-plan').click();
  await page.getByTestId('draft-title').fill(title);
  await page.getByTestId('create-draft').click();
  await expect(page).toHaveURL(/\/plan\/[a-z0-9]{15}\/edit$/);
  await page.getByTestId('station-dot-NAPERVILLE').click();
  await page.getByTestId('venue-node-2').click();
  await page.getByTestId('sheet-add').click();
  await expect(page).toHaveURL(/\/edit$/);
  return page.url().replace(/\/edit$/, '');
}

test('someone else clones a route, names it on arrival, and both chats record it', async ({ page, browser }) => {
  const original = `Clone Source ${RUN}`;
  await login(page, 'E2E Builder', CREW);
  const sourceUrl = await makeDraft(page, original);

  const other = await (await browser.newContext()).newPage();
  await login(other, 'E2E Cloner', CREW);
  await other.goto(sourceUrl);
  await other.getByTestId('clone-route').click();
  await expect(other).toHaveURL(/\/plan\/[a-z0-9]{15}\/edit/);
  const box = other.getByTestId('route-title');
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(`${copy.cloneTitlePrefix} ${original}`);
  expect(await box.evaluate((el: HTMLInputElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);
  await expect(other.getByText('Naperville Wine Bar')).toBeVisible();

  // A taken name is refused and stays in the box.
  await other.keyboard.type(original.toUpperCase());
  await other.keyboard.press('Tab');
  await expect(other.getByTestId('route-title-error')).toHaveText(copy.titleTaken);
  await expect(box).toHaveValue(original.toUpperCase());

  const renamed = `Southside ${RUN}`;
  await box.fill(renamed);
  await box.press('Enter');
  await expect(other.getByTestId('route-title-error')).toBeHidden();
  await other.getByTestId('done-editing').click();
  await expect(other.getByTestId('note-cloned_from')).toContainText(original);
  await expect(other.getByTestId('note-renamed')).toContainText(renamed);
  const cloneUrl = other.url();

  // Cloning again from the clone's own editor lands on another editor, named and selected the same way.
  await other.goto(`${cloneUrl}/edit`);
  await expect(other.getByTestId('route-title')).toHaveValue(renamed);
  await other.getByTestId('clone-route').click();
  await expect(other).not.toHaveURL(new RegExp(`${new URL(cloneUrl).pathname}/edit`));
  await expect(other.getByTestId('route-title')).toHaveValue(`${copy.cloneTitlePrefix} ${renamed}`);
  await expect(other.getByTestId('route-title')).toBeFocused();
  // The flag is dropped once used, so a reload does not select the name again.
  await expect(other).toHaveURL(/\/plan\/[a-z0-9]{15}\/edit$/);

  await page.goto(sourceUrl);
  const back = page.getByTestId('note-cloned_to');
  await expect(back).toContainText('E2E Cloner');
  await expect(back.getByRole('link')).toHaveAttribute('href', new URL(cloneUrl).pathname);
  // A crew member cannot delete a note (no hold menu for it).
  await expect(page.getByTestId('note-cloned_to')).not.toHaveAttribute('tabindex', '0');
});

test('the Conductor renames The Route through Save', async ({ page }) => {
  await clearLockedCrawls();
  await login(page, 'E2E Rename Conductor', ADMIN);
  // Seeded like liveEdit.spec's first Save test: Save needs to know where the crew is.
  const { itineraryId } = await seedLockedCrawl({ ownerName: 'E2E Rename Conductor', eventDate: '2026-12-26', startTime: '12:00',
    departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z', extraVenueAtFirstStation: true });
  await page.goto(`/plan/${itineraryId}/edit`);
  await expect(page.getByTestId('clone-route')).toHaveCount(0);
  const name = `Renamed Route ${RUN}`;
  await page.getByTestId('route-title').fill(name);
  await page.getByTestId('route-title').press('Enter');
  await page.getByTestId('set-here-1').click();
  await page.getByTestId('save-plan').click();
  await page.getByTestId('bulletin-skip').click();
  await expect(page).toHaveURL(new RegExp(`/plan/${itineraryId}$`));
  await expect(page.getByTestId('note-renamed')).toContainText(name);
});
