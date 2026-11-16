import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import { PB, PROOF_JPEG, clearRoutes, login, openTab, seedLockedCrawl, superuserToken, tapDrink } from './helpers';
import { copy, proofCaption } from '../../src/lib/labels';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const DATE = '2026-12-26';
const MEDIA = '**/api/collections/media/records**';

async function tabDay(page: Page, name: string, extraVenueAtFirstStation = false) {
  await page.route('**/api/metra/**', r => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  await login(page, name, ADMIN);
  await clearRoutes();
  const crawl = await seedLockedCrawl({ ownerName: name, eventDate: DATE, startTime: '12:00', departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z', extraVenueAtFirstStation });
  await page.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
  await page.goto('/live');
  await openTab(page);
  return crawl;
}

const isProofPost = (req: Request) => req.method() === 'POST' && /\/api\/collections\/media\/records(\?|$)/.test(req.url());
/** The client-chosen record id inside a proof upload's multipart body. */
const proofId = (req: Request) => /name="id"\r\n\r\n([a-z0-9]{15})/.exec(req.postData() ?? '')?.[1] ?? '';

/** Holds every proof upload before it reaches the server until `release()`; the rest passes through. */
async function holdProofs(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const ids: string[] = [];
  await page.route(MEDIA, async (r: Route) => {
    if (!isProofPost(r.request())) return r.continue();
    ids.push(proofId(r.request()));
    await gate;
    await r.continue();
  });
  return { release, ids };
}

async function record(collection: string, id: string) {
  return fetch(`${PB}/api/collections/${collection}/records/${id}`, { headers: { Authorization: await superuserToken() } });
}

test('a drink counts once its photo lands', async ({ page }) => {
  await tabDay(page, 'E2E Tab Proof');
  const held = await holdProofs(page);
  await tapDrink(page, 'beer');
  // Sending: the button says so and nothing has counted yet.
  await expect(page.getByTestId('tab-sending-beer')).toHaveText(copy.tabSending);
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
  await expect(page.getByTestId('tab-total')).toHaveText('0');
  await expect(page.getByTestId('tab-sheet')).toContainText(copy.tabProofHint);
  held.release();
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('1');
  await expect(page.getByTestId('tab-total')).toHaveText('1');
  await expect(page.getByTestId('tab-sending-beer')).toHaveCount(0);
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  // The photo is ordinary Freight: in the strip, and once in chat, shown as the drink.
  await page.getByTestId('tab-close').click();
  await expect(page.getByTestId('freight-strip').locator('img')).toHaveCount(1);
  const chat = page.getByTestId('crew-chat');
  await expect(chat.locator('article:has(img)')).toHaveCount(1);
  await expect(chat.locator('article:has(img)')).toContainText(copy.drink_beer);
  await expect(chat).not.toContainText(copy.chatAdded);
  await chat.locator('article:has(img) button.photo').click();
  await expect(page.getByTestId('lightbox').locator('figcaption')).toContainText(proofCaption('beer', 'E2E Tab Proof'));
  const drink = await (await record('drink_entries', held.ids[0])).json();
  expect(drink).toMatchObject({ id: held.ids[0], kind: 'beer', media: held.ids[0] });
});

test('cancelling the camera changes nothing', async ({ page }) => {
  await tabDay(page, 'E2E Tab Cancel');
  let posts = 0;
  page.on('request', (req) => { if (isProofPost(req)) posts++; });
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('drink-beer').click();
  await (await chooser).element().dispatchEvent('cancel');
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
  await expect(page.locator('[data-testid^="tab-sending-"]')).toHaveCount(0);
  await expect(page.getByTestId('tab-retry')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(posts).toBe(0);
  // The next tap works as if nothing happened.
  await tapDrink(page, 'shot');
  await expect(page.getByTestId('drink-shot').locator('.count')).toHaveText('1');
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
});

test('a failed send takes the tap back and Retry lands it, for every photo that failed', async ({ page }) => {
  await tabDay(page, 'E2E Tab Retry');
  const ids: string[] = [];
  let failures = 2;
  await page.route(MEDIA, async (r) => {
    if (!isProofPost(r.request())) return r.continue();
    ids.push(proofId(r.request()));
    if (failures > 0) { failures--; return r.abort(); }
    return r.continue();
  });
  await tapDrink(page, 'shot');
  await expect(page.getByRole('alert')).toHaveText(copy.noSignal);
  await expect(page.getByTestId('tab-retry')).toHaveText(copy.tabRetry);
  // A second failure does not lose the first photo: one Retry sends both.
  await tapDrink(page, 'beer');
  await expect(page.getByTestId('tab-sending-beer')).toHaveCount(0);
  await expect(page.getByTestId('tab-retry-toast')).toContainText(copy.drink_shot);
  await expect(page.getByTestId('tab-retry-toast')).toContainText(copy.drink_beer);
  await expect(page.getByTestId('drink-shot').locator('.count')).toHaveText('0');
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
  await expect(page.getByTestId('tab-sending-shot')).toHaveCount(0);
  await page.getByTestId('tab-retry').click();
  await expect(page.getByTestId('drink-shot').locator('.count')).toHaveText('1');
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('1');
  await expect(page.getByTestId('tab-retry')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  // The same photos under the same ids: a Retry can never make a second drink.
  expect(ids).toHaveLength(4);
  expect([...ids.slice(2)].sort()).toEqual([...ids.slice(0, 2)].sort());
});

test('a send whose answer was lost but whose drink arrives drops its Retry', async ({ page }) => {
  await tabDay(page, 'E2E Tab Lost Answer');
  let lose = true, feedUp = false;
  // Keep the feed from learning of the drink (realtime reloads it) until the toast has been seen.
  await page.route(/\/api\/collections\/(drink_entries|media)\/records\?/, (r) => r.request().method() === 'GET' && !feedUp ? r.abort() : r.continue());
  await page.route(MEDIA, async (r) => {
    if (!isProofPost(r.request()) || !lose) return r.fallback();
    lose = false;
    await r.fetch();          // the upload lands on the server ...
    await r.abort();          // ... and the answer never reaches the phone
  });
  await tapDrink(page, 'beer');
  await expect(page.getByTestId('tab-retry-toast')).toBeVisible();
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
  feedUp = true;
  await page.clock.runFor(30_000);                 // the feed's poll brings the drink in
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('1');
  await expect(page.getByTestId('tab-retry-toast')).toHaveCount(0);
});

test('a refused send shows its message and offers no Retry', async ({ page }) => {
  await tabDay(page, 'E2E Tab Refused');
  await page.route(MEDIA, (r) => isProofPost(r.request())
    ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ status: 400, message: 'proof_needs_stop', data: {} }) })
    : r.continue());
  await tapDrink(page, 'shot');
  await expect(page.getByRole('alert')).toHaveText(copy.proofNeedsStop);
  await expect(page.getByTestId('tab-retry')).toHaveCount(0);
  await expect(page.getByTestId('tab-retry-toast')).toHaveCount(0);
});

test('the Retry toast can be closed', async ({ page }) => {
  await tabDay(page, 'E2E Tab Retry Close');
  await page.route(MEDIA, (r) => isProofPost(r.request()) ? r.abort() : r.continue());
  await tapDrink(page, 'shot');
  await expect(page.getByTestId('tab-retry-toast')).toBeVisible();
  await page.getByTestId('tab-retry-close').click();
  await expect(page.getByTestId('tab-retry-toast')).toHaveCount(0);
  await expect(page.getByTestId('drink-shot').locator('.count')).toHaveText('0');
});

test('a saved drink whose read-back fails counts as sent and arrives with the next reload', async ({ page }) => {
  await tabDay(page, 'E2E Tab Readback');
  await page.route('**/api/collections/drink_entries/records**', r => r.request().method() === 'GET' ? r.abort() : r.continue());
  await tapDrink(page, 'cocktail');
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await expect(page.getByTestId('tab-retry')).toHaveCount(0);
  await page.unroute('**/api/collections/drink_entries/records**');
  await page.clock.runFor(30_000);                 // the feed's poll
  await expect(page.getByTestId('drink-cocktail').locator('.count')).toHaveText('1');
});

test('Undo removes the drink and its photo', async ({ page }) => {
  await tabDay(page, 'E2E Tab Undo Photo');
  const ids: string[] = [];
  page.on('request', (req) => { if (isProofPost(req)) ids.push(proofId(req)); });
  await tapDrink(page, 'beer');
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await expect(page.getByTestId('freight-strip').locator('img')).toHaveCount(1);
  await page.getByTestId('tab-undo').click();
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
  await expect(page.getByTestId('freight-strip')).toHaveCount(0);
  await expect(page.getByTestId('crew-chat').locator('article:has(img)')).toHaveCount(0);
  expect((await record('drink_entries', ids[0])).status).toBe(404);
  expect((await record('media', ids[0])).status).toBe(404);
});

test('moving to the next stop while a photo sends still counts it at the stop it was taken', async ({ page }) => {
  const crawl = await tabDay(page, 'E2E Tab Moved On', true);
  const held = await holdProofs(page);
  await tapDrink(page, 'beer');
  await expect(page.getByTestId('tab-sending-beer')).toBeVisible();
  // The crawl walks on to the second bar at the same station while the photo is still on its way.
  // The board re-reads the clock on a 15 s tick, so let one run after the jump.
  await page.clock.fastForward('01:30:00');
  await page.clock.runFor(16_000);
  await expect(page.getByTestId('strip-stop-1')).toHaveAttribute('aria-current', 'step');
  held.release();
  await expect(page.getByTestId('tab-total')).toHaveText('1');
  await expect(page.getByTestId('tab-sending-beer')).toHaveCount(0);
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');   // not this bar's
  const drink = await (await record('drink_entries', held.ids[0])).json();
  expect(drink.stop).toBe(crawl.firstStopId);
});

test('a drink is filed at the stop where it was tapped, even if the camera returns after the Tab closed and the crawl moved on', async ({ page }) => {
  const crawl = await tabDay(page, 'E2E Tab Tapped Here', true);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('drink-beer').click();
  const camera = await chooser;
  // While the camera is open the Tab is closed and the crawl walks on to the second bar.
  await page.getByTestId('tab-close').click();
  await expect(page.getByTestId('tab-sheet')).toHaveCount(0);
  await page.clock.fastForward('01:30:00');
  await page.clock.runFor(16_000);
  await expect(page.getByTestId('strip-stop-1')).toHaveAttribute('aria-current', 'step');
  await camera.setFiles(PROOF_JPEG);
  await expect(page.getByTestId('tab-bar-total')).toHaveText('1');
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  const drinks = await (await fetch(`${PB}/api/collections/drink_entries/records?filter=${encodeURIComponent(`stop.itinerary="${crawl.itineraryId}"`)}`,
    { headers: { Authorization: await superuserToken() } })).json();
  expect(drinks.items.map((d: { stop: string }) => d.stop)).toEqual([crawl.firstStopId]);
});

test('overlapping taps with a slow server count exactly once each, and never while in flight', async ({ page }) => {
  await tabDay(page, 'E2E Tab Slow');
  let posts = 0, answered = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  // Hold both uploads, then delay each RESPONSE: the create reaches the server (and PocketBase's
  // realtime broadcast) first, so the saved row can land via realtime/reload before this fetch's own
  // promise resolves in the page — the interleaving that must not double-count.
  await page.route(MEDIA, async r => {
    if (!isProofPost(r.request())) return r.continue();
    posts++;
    await gate;
    const response = await r.fetch();
    await new Promise(res => setTimeout(res, 800));
    await r.fulfill({ response });
  });
  const after: Request[] = [];
  page.on('requestfinished', (req) => { if (isProofPost(req)) answered++; });
  page.on('request', (req) => {
    if (answered >= 2 && req.method() === 'GET' && req.url().includes('/api/collections/')) after.push(req);
  });
  const beer = page.getByTestId('drink-beer').locator('.count');
  await tapDrink(page, 'beer');
  await tapDrink(page, 'beer');
  await expect.poll(() => posts).toBe(2);
  await expect(page.getByTestId('tab-sending-beer')).toBeVisible();
  await expect(beer).toHaveText('0');              // nothing counts before the server has the photo
  await expect(page.getByTestId('tab-total')).toHaveText('0');
  release();
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await expect.poll(() => answered).toBe(2);       // both saved
  // loadFeed() reads these four together and applies nothing until all have answered.
  const feed = ['/drink_entries/', '/media/', '/chat_messages/', '/reactions/'];
  await expect.poll(() => feed.every((c) => after.some((r) => r.url().includes(c)))).toBe(true);
  await Promise.all(after.map(async (r) => (await r.response())?.finished()));
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));   // the reload has been applied
  await expect(beer).toHaveText('2');
  await expect(page.getByTestId('tab-total')).toHaveText('2');
  await expect(page.getByTestId('tab-sending-beer')).toHaveCount(0);
  expect(posts).toBe(2);
});

test('a failed Undo keeps its button so it can be retried', async ({ page }) => {
  await tabDay(page, 'E2E Tab Undo Retry');
  await tapDrink(page, 'beer');
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  const block = (r: Route) => r.request().method() === 'DELETE' ? r.abort() : r.continue();
  await page.route('**/api/collections/drink_entries/records/**', block);
  await page.getByTestId('tab-undo').click();
  await expect(page.getByRole('alert')).toHaveText(copy.noSignal);
  await expect(page.getByTestId('tab-undo')).toBeVisible();
  await page.clock.runFor(10_000);                 // a failed toast does not time out
  await expect(page.getByTestId('tab-undo')).toBeVisible();
  await page.unroute('**/api/collections/drink_entries/records/**', block);
  await page.getByTestId('tab-undo').click();
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
  await expect(page.getByTestId('tab-toast')).toBeHidden();
});

test('a 404 on Undo (already removed elsewhere) is treated as done, not a failure', async ({ page }) => {
  await tabDay(page, 'E2E Tab Undo Already Gone');
  await tapDrink(page, 'beer');
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await page.route('**/api/collections/drink_entries/records/**', async (r) => {
    if (r.request().method() !== 'DELETE') return r.continue();
    await r.fetch();   // the row really goes, as when someone else removed it first
    await r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 404, message: 'not found', data: {} }) });
  });
  await page.getByTestId('tab-undo').click();
  await expect(page.getByTestId('tab-toast')).toBeHidden();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
});

test('a repeat Undo tap while one is in flight is ignored, not sent twice', async ({ page }) => {
  await tabDay(page, 'E2E Tab Undo Inflight');
  await tapDrink(page, 'beer');
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  let deletes = 0;
  await page.route('**/api/collections/drink_entries/records/**', async r => {
    if (r.request().method() !== 'DELETE') return r.continue();
    deletes++;
    await new Promise((res) => setTimeout(res, 500));
    await r.continue();
  });
  const deleted = page.waitForResponse((res) => res.request().method() === 'DELETE' && res.url().includes('/api/collections/drink_entries/records/'));
  await page.getByTestId('tab-undo').click();
  await page.getByTestId('tab-undo').click();
  await deleted;
  expect(deletes).toBe(1);
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
});

test('after the toast is gone the newest saved drink can be undone, never a tap still sending', async ({ page }) => {
  await tabDay(page, 'E2E Tab Undo Last Pending');
  await tapDrink(page, 'food');
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await page.clock.runFor(5_000);
  await expect(page.getByTestId('tab-toast')).toBeHidden();
  await expect(page.getByTestId('tab-undo-last')).toBeVisible();

  const held = await holdProofs(page);
  await tapDrink(page, 'beer');
  await expect(page.getByTestId('tab-sending-beer')).toBeVisible();
  // While the beer is still sending it has not counted, and no Undo is offered for it.
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
  await expect(page.getByTestId('tab-toast')).toBeHidden();
  await expect(page.getByTestId('tab-undo-last')).toBeHidden();
  held.release();

  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('1');

  // Once that toast is gone too, Undo my last one takes the beer, the newest saved drink.
  await page.clock.runFor(5_000);
  await expect(page.getByTestId('tab-toast')).toBeHidden();
  await page.getByTestId('tab-undo-last').click();
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');
  await expect(page.getByTestId('drink-food').locator('.count')).toHaveText('1');
});

test('a second tap before the first toast fades retargets Undo, not the earlier one', async ({ page }) => {
  // Regression for a race the sim rehearsal test caught: a stale toast must not let Undo remove
  // the wrong drink when a second tap lands while the first toast is still showing.
  await tabDay(page, 'E2E Tab Retarget');
  await tapDrink(page, 'beer');
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await tapDrink(page, 'water');
  await expect(page.getByTestId('drink-water').locator('.count')).toHaveText('1');
  await page.getByTestId('tab-undo').click();
  await expect(page.getByTestId('drink-water').locator('.count')).toHaveText('0');
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('1');
});

test('the Tab offers five counters, each a camera; the tab bar opens it from any screen, and it closes without losing the count', async ({ page }) => {
  await tabDay(page, 'E2E Tab Sheet');
  // Five illustrated personal counters (no wine; water is NA), each opening the camera.
  await expect(page.getByTestId('drink-wine')).toHaveCount(0);
  await expect(page.getByTestId('drink-water')).toContainText('NA');
  await expect(page.getByTestId('tab-camera')).toHaveAttribute('capture', 'environment');
  await expect(page.getByTestId('tab-camera')).toHaveAttribute('accept', 'image/*');
  await expect(page.getByTestId('camera-button')).toBeVisible();
  await expect(page.getByTestId('freight-camera')).toHaveAttribute('capture', 'environment');
  await tapDrink(page, 'beer');
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  // The day's first beer is this phone's Pathfinder: Escape closes its card before it closes the Tab.
  await expect(page.getByTestId('spike-celebration')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('spike-celebration')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tab-sheet')).toHaveCount(0);
  // The toast outlives the sheet, and the bar carries the day's count.
  await expect(page.getByTestId('tab-toast')).toBeVisible();
  await expect(page.getByTestId('tab-bar-total')).toHaveText('1');
  await expect(page.getByTestId('tab-menu')).toHaveCount(0);

  await page.getByTestId('tab-crew').click();
  await expect(page).toHaveURL(/\/crew$/);
  await page.getByTestId('tab-drinks').click();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('tab-sheet')).toBeVisible();
  await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('1');
  await page.getByTestId('tab-scrim').click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId('tab-sheet')).toHaveCount(0);
});
