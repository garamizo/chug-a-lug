import { test, expect } from '@playwright/test';
import { clearRoutes, login, seedDraftRoute, settledOn, swipe } from './helpers';

// The route planner's line: going stops left of it, return stops right of it, one row per station.
const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const OWNER = 'E2E Two Sides';
let ids: { itineraryId: string; stopIds: string[] };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/places/nearby**', (r) => r.fulfill({ json: { venues: [] } }));
  await page.route('**/api/places/attach', (r) => r.fulfill({ status: 503, json: { message: 'Google Places is not configured on the server.' } }));
  await page.route('**/api/places/photos', (r) => r.fulfill({ json: { status: 'none', place: null } }));
  await login(page, OWNER, ADMIN);
  await clearRoutes();
  ids = await seedDraftRoute({ ownerName: OWNER, eventDate: '2026-12-26', startTime: '12:00', stops: [
    { name: 'Going Naperville', station_id: 'NAPERVILLE', station_name: 'Naperville', direction: 'out' },
    { name: 'Going La Grange', station_id: 'LAGRANGE', station_name: 'La Grange Road', direction: 'out' },
    { name: 'Back One', station_id: 'NAPERVILLE', station_name: 'Naperville', direction: 'back' },
    { name: 'Back Two', station_id: 'NAPERVILLE', station_name: 'Naperville', direction: 'back', photo: true },
    { name: 'Back Three', station_id: 'NAPERVILLE', station_name: 'Naperville', direction: 'back' }
  ] });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test.beforeEach(async ({ page }) => {
    await page.goto(`/plan/${ids.itineraryId}/edit`);
    await expect(page.getByTestId('stop-row-4')).toBeAttached();
  });

  test('going stops sit left of the line and return stops right, in one row per station', async ({ page }) => {
    const row = page.getByTestId('map-row-NAPERVILLE');
    await expect(page.getByTestId('map-row-back-NAPERVILLE')).toHaveCount(0);
    await expect(row.locator('.cell.left').getByTestId('stop-row-0')).toHaveAttribute('data-side', 'left');
    for (const i of [2, 3, 4]) await expect(row.locator('.cell.right').getByTestId(`stop-row-${i}`)).toHaveAttribute('data-side', 'right');
    const dot = await page.getByTestId('station-dot-NAPERVILLE').boundingBox();
    const going = await page.getByTestId('stop-row-0').boundingBox();
    const back = await page.getByTestId('stop-row-2').boundingBox();
    expect(going!.x + going!.width).toBeLessThanOrEqual(dot!.x + 1);
    expect(back!.x).toBeGreaterThanOrEqual(dot!.x + dot!.width - 1);
  });

  test('on a phone the focused side fills the line and the other peeks in', async ({ page }) => {
    await settledOn(page, 'left');
    const vp = page.getByTestId('line-viewport');
    const box = (await vp.boundingBox())!;
    const going = (await page.getByTestId('stop-row-0').boundingBox())!;
    expect(going.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(going.x + going.width).toBeLessThanOrEqual(box.x + box.width + 1);
    const back = (await page.getByTestId('stop-row-2').boundingBox())!;
    expect(back.x).toBeLessThan(box.x + box.width);
    expect(back.x + back.width).toBeGreaterThan(box.x + box.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await expect(page.getByTestId('station-label-LAGRANGE-left')).toBeVisible();
    await expect(page.getByTestId('station-label-LAGRANGE-right')).toBeHidden();
  });

  test('a tab, a drag or a card on the other side switches sides', async ({ page }) => {
    const vp = page.getByTestId('line-viewport');
    await expect(page.getByTestId('side-left')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('side-right').click();
    await settledOn(page, 'right');
    const box = (await vp.boundingBox())!;
    const y = box.y + 60;
    await swipe(page, { x: box.x + 40, y }, { x: box.x + box.width - 20, y });
    await settledOn(page, 'left');
    await expect(page.getByTestId('side-left')).toHaveAttribute('aria-selected', 'true');
    await swipe(page, { x: box.x + box.width - 20, y }, { x: box.x + 20, y });
    await settledOn(page, 'right');
    await page.getByTestId('side-left').click();
    await settledOn(page, 'left');
    await page.getByTestId('stop-link-2').focus();
    await settledOn(page, 'right');
  });

  test('a vertical finger swipe over the line scrolls the page', async ({ page }) => {
    const vp = page.getByTestId('line-viewport');
    await vp.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    const box = (await vp.boundingBox())!;
    // Start on a card in the focused pane, well inside the line, and drag the finger up.
    const x = box.x + box.width / 3;
    const before = await page.evaluate(() => window.scrollY);
    await swipe(page, { x, y: box.y + 300 }, { x, y: box.y + 60 });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
    await expect(page.getByTestId('line-viewport')).toHaveAttribute('data-focused', 'left');
  });

  test('a photographed middle stop fits its pane with room for its name', async ({ page }) => {
    await page.getByTestId('side-right').click();
    await settledOn(page, 'right');
    await expect(page.getByTestId('stop-photo-3')).toBeVisible();
    const vp = (await page.getByTestId('line-viewport').boundingBox())!;
    const card = (await page.getByTestId('stop-row-3').boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(vp.x - 1);
    expect(card.x + card.width).toBeLessThanOrEqual(vp.x + vp.width + 1);
    const name = (await page.getByTestId('stop-link-3').locator('strong').boundingBox())!;
    // The room the name has: from where it starts to the head's content edge (the text itself is short).
    const room = await page.getByTestId('stop-link-3').evaluate((head, nameX) => {
      const r = head.getBoundingClientRect();
      return r.right - parseFloat(getComputedStyle(head).paddingRight) - nameX;
    }, name.x);
    expect(room).toBeGreaterThanOrEqual(80);
    for (const id of ['up-3', 'down-3', 'remove-3']) {
      const b = (await page.getByTestId(id).boundingBox())!;
      const overlaps = b.x < name.x + name.width && name.x < b.x + b.width && b.y < name.y + name.height && name.y < b.y + b.height;
      expect(overlaps, id).toBe(false);
      expect(b.x + b.width).toBeLessThanOrEqual(card.x + card.width + 1);
    }
  });

  test('a read-only route still has both tabs and no station buttons', async ({ page }) => {
    await page.goto(`/plan/${ids.itineraryId}`);
    await expect(page.getByTestId('stop-row-4')).toBeAttached();
    await expect(page.getByTestId('side-right')).toBeVisible();
    await expect(page.locator('[data-testid^="station-dot-"]')).toHaveCount(0);
    await page.getByTestId('side-right').click();
    await settledOn(page, 'right');
  });

  test('after adding a return stop the right side is still in focus', async ({ page }) => {
    await page.getByTestId('side-right').click();
    await settledOn(page, 'right');
    await page.getByTestId('station-dot-LAGRANGE').click();
    await expect(page).toHaveURL(/side=right/);
    await page.getByTestId('manual-name').fill('Back At La Grange');
    await page.getByTestId('manual-add').click();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByText('Back At La Grange')).toBeAttached();
    await settledOn(page, 'right');
    await expect(page.getByTestId('side-right')).toHaveAttribute('aria-selected', 'true');
  });

  test('a mouse wheel over the line scrolls the page', async ({ page }) => {
    const box = (await page.getByTestId('line-viewport').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  });
});

test.describe('on a wide screen', () => {
  test.use({ viewport: { width: 1024, height: 800 } });
  test.beforeEach(async ({ page }) => {
    await page.goto(`/plan/${ids.itineraryId}/edit`);
    await expect(page.getByTestId('stop-row-4')).toBeAttached();
  });

  test('a wide screen shows both sides in full and nothing scrolls sideways', async ({ page }) => {
    const vp = page.getByTestId('line-viewport');
    expect(await vp.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    const box = (await vp.boundingBox())!;
    for (const i of [0, 2]) {
      const c = (await page.getByTestId(`stop-row-${i}`).boundingBox())!;
      expect(c.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(c.x + c.width).toBeLessThanOrEqual(box.x + box.width + 1);
    }
  });

  test('on a wide screen the tab still picks the side a station tap adds to', async ({ page }) => {
    await page.getByTestId('side-right').click();
    await expect(page.getByTestId('side-right')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('station-label-LAGRANGE-left')).toBeVisible();
    await expect(page.getByTestId('station-label-LAGRANGE-right')).toBeHidden();
    await page.getByTestId('station-dot-LAGRANGE').click();
    await expect(page).toHaveURL(/side=right/);
  });
});
