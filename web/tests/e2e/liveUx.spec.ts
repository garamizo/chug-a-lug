import { expect, test, type Page } from '@playwright/test';
import { clearLockedCrawls, login, seedLockedCrawl } from './helpers';
import { copy } from '../../src/lib/labels';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

async function liveDay(page: Page, name: string) {
  await page.route('**/api/metra/**', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  await login(page, name, ADMIN);
  await clearLockedCrawls();
  const ids = await seedLockedCrawl({ ownerName: name, eventDate: '2026-12-26', startTime: '12:00', departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
  await page.goto('/live');
  await expect(page.getByTestId('departure-board')).toBeVisible();
  return ids;
}

test('a Freight photo opens in the viewer and back closes it without leaving Live', async ({ page }) => {
  await liveDay(page, 'E2E Lightbox');
  await page.getByTestId('freight-input').setInputFiles({ name: 'bar.gif', mimeType: 'image/gif', buffer: GIF });
  await page.getByTestId('freight-open-0').click();
  await expect(page.getByTestId('lightbox')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('lightbox')).toBeHidden();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('departure-board')).toBeVisible();
});

test('the ticket\'s station opens walking directions back to it', async ({ page }) => {
  await liveDay(page, 'E2E Station Link');
  const link = page.getByTestId('departure-board').getByTestId('station-walk');
  await expect(link).toHaveAttribute('href', /destination=.*Metra\+Station&travelmode=walking/);
  await expect(link).toHaveAttribute('target', '_blank');
});

test('tapping the current stop opens its sheet over Live; back closes it', async ({ page }) => {
  const ids = await liveDay(page, 'E2E Stop Sheet');
  await page.getByTestId('current-stop').click();
  await expect(page).toHaveURL(new RegExp(`/live\\?stop=${ids.firstStopId}$`));
  await expect(page.getByTestId('sheet-name')).toHaveText('The Whistle Stop');
  await expect(page.getByTestId('sheet-walk')).toHaveAttribute('href', /travelmode=walking/);
  await expect(page.getByTestId('sheet-call')).toHaveCount(0);
  // The sheet scrolls on its own; Live underneath must not move with it.
  await expect(page.getByTestId('stop-sheet')).toHaveCSS('overscroll-behavior-y', 'contain');
  await expect(page.locator('html')).toHaveCSS('overflow-y', 'hidden');
  // Close sits on the right edge for a one-handed thumb.
  const sheet = (await page.getByTestId('stop-sheet').boundingBox())!;
  const close = (await page.getByTestId('sheet-close').boundingBox())!;
  expect(sheet.x + sheet.width - (close.x + close.width)).toBeLessThan(40);
  await page.getByTestId('sheet-next').click();
  await expect(page.getByTestId('sheet-name')).toHaveText('Berwyn Beer Hall');
  await page.goBack();
  await expect(page.locator('html')).not.toHaveCSS('overflow-y', 'hidden');
  await expect(page.getByTestId('stop-sheet')).toBeHidden();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('departure-board')).toBeVisible();
});

test('a photo opened from the sheet sits above it, and back steps out one layer at a time', async ({ page }) => {
  await liveDay(page, 'E2E Sheet Photo');
  await page.getByTestId('freight-input').setInputFiles({ name: 'bar.gif', mimeType: 'image/gif', buffer: GIF });
  await expect(page.getByTestId('freight-open-0')).toBeVisible();
  await page.getByTestId('current-stop').click();
  await page.getByTestId('stop-sheet').locator('.gallery button').first().click();
  await expect(page.getByTestId('lightbox')).toBeVisible();
  await page.getByTestId('lightbox-close').click();          // the viewer's own control must be clickable
  await expect(page.getByTestId('lightbox')).toBeHidden();
  await expect(page.getByTestId('stop-sheet')).toBeVisible();
  await page.getByTestId('stop-sheet').locator('.gallery button').first().click();
  await page.goBack();
  await expect(page.getByTestId('lightbox')).toBeHidden();
  await expect(page.getByTestId('stop-sheet')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('stop-sheet')).toBeHidden();
  await expect(page).toHaveURL(/\/live$/);
});

test('a shared stop link opens the sheet, and closing it stays on Live', async ({ page }) => {
  const ids = await liveDay(page, 'E2E Sheet Link');
  await page.goto(`/live?stop=${ids.secondStopId}`);
  await expect(page.getByTestId('sheet-name')).toHaveText('Berwyn Beer Hall');
  await page.getByTestId('sheet-close').click();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('stop-sheet')).toBeHidden();
});

test('on the event day The Route opens stops in the sheet, not the planner', async ({ page }) => {
  await liveDay(page, 'E2E Route Sheet');
  await page.getByTestId('tab-route').click();
  await page.getByTestId('stop-link-1').click();
  await expect(page.getByTestId('sheet-name')).toHaveText('Berwyn Beer Hall');
  await expect(page).toHaveURL(/\/route\?stop=/);
});

test('the route strip shows where the crew is and opens any stop', async ({ page }) => {
  await liveDay(page, 'E2E Route Strip');
  await expect(page.getByTestId('strip-stop-0')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('strip-stop-1')).not.toHaveAttribute('aria-current', 'step');
  await page.getByTestId('strip-stop-1').click();
  await expect(page.getByTestId('sheet-name')).toHaveText('Berwyn Beer Hall');
});

test('the crew can talk and Cheers each other across phones', async ({ page, browser }) => {
  await liveDay(page, 'E2E Chat Host');
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
    await login(other, 'E2E Chat Guest', CREW);
    await other.goto('/live');
    await other.getByTestId('chat-input').fill('Grabbing a table in the back');
    await other.getByTestId('chat-send').click();
    await expect(other.getByTestId('chat-input')).toHaveValue('');
    const message = page.getByTestId('crew-chat').locator('article', { hasText: 'Grabbing a table in the back' });
    await expect(message).toContainText('E2E Chat Guest');
    const cheersButton = message.getByRole('button', { name: /Cheers/ });
    const otherCheersButton = other.getByTestId('crew-chat').locator('article', { hasText: 'Grabbing a table' }).getByRole('button', { name: /Cheers/ });
    await cheersButton.click();
    await expect(cheersButton).toHaveAttribute('aria-pressed', 'true');
    await expect(otherCheersButton).toContainText('1');
    await cheersButton.click();
    await expect(cheersButton).toHaveAttribute('aria-pressed', 'false');
    await expect(otherCheersButton).not.toContainText('1');
  } finally { await context.close(); }
});

test('a photo shared in chat gets an accessible open label', async ({ page }) => {
  await liveDay(page, 'E2E Chat Photo Label');
  await page.getByTestId('freight-input').setInputFiles({ name: 'bar.gif', mimeType: 'image/gif', buffer: GIF });
  await expect(page.getByTestId('crew-chat').getByRole('button', { name: copy.openFreightPhoto })).toBeVisible();
});

test('the crew chat celebrates the first beer', async ({ page }) => {
  await liveDay(page, 'E2E Milestone');
  await page.getByTestId('drink-beer').click();
  await expect(page.getByTestId('crew-chat').locator('article.milestone')).toContainText('First of the day: Beer · E2E Milestone');
});

test('a fast double tap on close never pops past Live', async ({ page }) => {
  await liveDay(page, 'E2E Double Close');
  await page.getByTestId('freight-input').setInputFiles({ name: 'bar.gif', mimeType: 'image/gif', buffer: GIF });
  await page.getByTestId('freight-open-0').click();
  await expect(page.getByTestId('lightbox')).toBeVisible();
  await page.getByTestId('lightbox-close').dblclick();
  await expect(page.getByTestId('lightbox')).toBeHidden();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('departure-board')).toBeVisible();

  await page.getByTestId('current-stop').click();
  await expect(page.getByTestId('stop-sheet')).toBeVisible();
  await page.getByTestId('sheet-close').dblclick();
  await expect(page.getByTestId('stop-sheet')).toBeHidden();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('departure-board')).toBeVisible();
});

test('the Conductor reaches the locked-route editor from Live, not a direct link to the planner', async ({ page }) => {
  const ids = await liveDay(page, 'E2E Route Edit');
  await page.getByTestId('tab-route').click();
  await page.getByTestId('edit-route').click();
  await expect(page).toHaveURL(new RegExp(`/plan/${ids.itineraryId}/edit$`));
  await expect(page.getByTestId('live-route-warning')).toBeVisible();
});

test('the leaderboard line puts me on the podium and opens the Crew Board', async ({ page }) => {
  await liveDay(page, 'E2E Podium');
  await page.getByTestId('drink-beer').click();
  await expect(page.getByTestId('leaderboard')).toContainText('you 1');
  await expect(page.getByRole('link', { name: /Leaderboard: .*you 1/ })).toBeVisible();
  await page.getByTestId('leaderboard').click();
  await expect(page).toHaveURL(/\/crew$/);
});
