import { expect, test } from '@playwright/test';
import { clearRoutes, login, openTab, PB, PROOF_JPEG, seedLockedCrawl, sessionFor, setRole, superuserToken, tapDrink } from './helpers';

const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';
const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const EVENT_DAY = new Date('2026-12-26T19:00:00Z');
const stubMetra = (p: import('@playwright/test').Page) => p.route('**/api/metra/**', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));

/** The Conductor on a fresh event-day route, with the Crew Board open. */
async function openBoard(page: import('@playwright/test').Page, conductor: string) {
  await login(page, conductor, ADMIN);
  await clearRoutes();
  const ids = await seedLockedCrawl({ ownerName: conductor, eventDate: '2026-12-26', startTime: '12:00',
    departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z' });
  await stubMetra(page);
  await page.clock.install({ time: EVENT_DAY });
  await page.goto('/crew');
  await expect(page.getByTestId('crew-row').filter({ hasText: conductor })).toBeVisible();
  return ids;
}


test('the open Crew Board follows new users, drinks, undo and acknowledgements', async ({ page, browser }) => {
  const { copy } = await import('../../src/lib/labels');
  await login(page, 'E2E Roster Conductor', process.env.ADMIN_PASSWORD ?? 'admin-test-password');
  await clearRoutes();
  await seedLockedCrawl({
    ownerName: 'E2E Roster Conductor', eventDate: '2026-12-26', startTime: '12:00',
    departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z'
  });
  await page.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
  await page.goto('/crew');
  await expect(page.getByTestId('crew-row').filter({ hasText: 'E2E Roster Conductor' })).toBeVisible();
  const other = await browser.newContext();
  try {
    const crew = await other.newPage();
    await crew.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
    await login(crew, 'E2E Roster Late Arrival', CREW);
    const row = page.getByTestId('crew-row').filter({ hasText: 'E2E Roster Late Arrival' });
    await expect(row).toBeVisible();
    await crew.goto('/live');
    await openTab(crew);
    await tapDrink(crew, 'beer');
    await expect(row.locator('.tab > span[title="Beer"]')).toContainText('1');
    await crew.getByTestId('tab-undo').click();
    await expect(row.locator('.tab > span[title="Beer"]')).toContainText('0');
    await crew.getByTestId('tab-close').click();
    await page.getByTestId('menu').click();
    await page.getByTestId('menu-bulletin').click();
    await page.getByTestId('bulletin-body').fill('Crew Board acknowledgement test.');
    await page.getByTestId('bulletin-send').click();
    await expect(row.locator('.seen')).toHaveText(copy.unseenBulletin);
    await crew.getByTestId('bulletin-ack').click();
    await expect(row.locator('.seen')).toHaveText(copy.seenBulletin);
    await page.getByTestId('bulletin-ack').click();
    await expect(page.getByTestId('crew-row').filter({ hasText: 'E2E Roster Conductor' }).locator('.seen')).toHaveText(copy.seenBulletin);
  } finally { await other.close(); }
});

test('the Crew Board shows a laurel and a count for each Golden Spike, live', async ({ page, browser }) => {
  const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const EVENT_DAY = new Date('2026-12-26T19:00:00Z');
  const stub = (p: import('@playwright/test').Page) => p.route('**/api/metra/**', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  await login(page, 'E2E Laurel Conductor', process.env.ADMIN_PASSWORD ?? 'admin-test-password');
  await clearRoutes();
  await seedLockedCrawl({ ownerName: 'E2E Laurel Conductor', eventDate: '2026-12-26', startTime: '12:00',
    departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z' });
  await stub(page);
  await page.clock.install({ time: EVENT_DAY });
  await page.goto('/crew');
  const row = page.getByTestId('crew-row').filter({ hasText: 'E2E Laurel Rider' });
  const laurel = row.getByTestId('spike-laurel');
  await expect(page.getByTestId('crew-row').filter({ hasText: 'E2E Laurel Conductor' })).toBeVisible();
  const context = await browser.newContext();
  try {
    const rider = await context.newPage();
    await stub(rider);
    await rider.clock.install({ time: EVENT_DAY });
    await login(rider, 'E2E Laurel Rider', CREW);
    await rider.goto('/live');
    await expect(rider.getByTestId('departure-board')).toBeVisible();
    await openTab(rider);
    await tapDrink(rider, 'beer');
    await expect(laurel).toHaveText('1');
    await expect(laurel).toHaveAttribute('aria-label', /Golden Spikes: Pathfinder/);
    await rider.keyboard.press('Escape');
    await rider.getByTestId('tab-close').click();

    for (let i = 1; i <= 5; i++) {
      await rider.getByTestId('chat-input').fill(`laurel ${i}`);
      await rider.getByTestId('chat-input').press('Enter');
      await expect(rider.getByTestId('chat-input')).toHaveValue('');
    }
    await expect(laurel).toHaveText('2');
    await expect(laurel).toHaveAttribute('aria-label', /Whistle Stop/);

    await rider.getByTestId('freight-input').setInputFiles(['a', 'b', 'c'].map((n) => ({ name: `${n}.gif`, mimeType: 'image/gif', buffer: GIF })));
    await expect(laurel).toHaveText('3');
    await expect(laurel).toHaveAttribute('aria-label', /Railfan/);

    // The Conductor deletes one photo: the third is gone, and so is Railfan.
    const { token } = await sessionFor('E2E Laurel Conductor', true);
    const list = await (await fetch(`${PB}/api/collections/media/records?${new URLSearchParams({ filter: 'drink_kind = ""', sort: '-created' })}`, { headers: { Authorization: token } })).json();
    const del = await fetch(`${PB}/api/collections/media/records/${list.items[0].id}`, { method: 'DELETE', headers: { Authorization: token } });
    expect(del.status).toBe(204);
    await expect(laurel).toHaveText('2');
    await expect(laurel).not.toHaveAttribute('aria-label', /Railfan/);

    await page.goto('/live');
    await page.goto('/crew');
    await expect(laurel).toHaveText('2');
  } finally { await context.close(); }
});

test('the Conductor makes someone a Trainspotter from the Crew Board', async ({ page }) => {
  await sessionFor('E2E Role Rider');
  await openBoard(page, 'E2E Role Conductor');
  await page.getByTestId('crew-row').filter({ hasText: 'E2E Role Rider' }).getByTestId('crew-name-button').click();
  const window = page.getByTestId('role-window');
  await expect(window).toContainText('E2E Role Rider');
  await expect(page.getByTestId('role-option-crew')).toBeChecked();
  await page.getByTestId('role-option-trainspotter').check();
  await page.getByTestId('role-save').click();
  await expect(window).toHaveCount(0);
  const spotted = page.getByTestId('crew-trainspotters').getByTestId('crew-row').filter({ hasText: 'E2E Role Rider' });
  await expect(spotted).toBeVisible();
  await expect(spotted.locator('.tab')).toHaveCount(0);
  await expect(spotted.getByTestId('spike-laurel')).toHaveCount(0);
});

test('a put-off person is gone for the crew and dimmed for the Conductor', async ({ page, browser }) => {
  await sessionFor('E2E Putoff Rider');
  await openBoard(page, 'E2E Putoff Conductor');
  await page.getByTestId('crew-row').filter({ hasText: 'E2E Putoff Rider' }).getByTestId('crew-name-button').click();
  await page.getByTestId('role-option-put_off').check();
  // Declining the confirmation saves nothing and keeps the window open.
  page.once('dialog', (d) => d.dismiss());
  await page.getByTestId('role-save').click();
  await expect(page.getByTestId('role-window')).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('role-save').click();
  await expect(page.getByTestId('role-window')).toHaveCount(0);
  await expect(page.getByTestId('crew-put-off').getByTestId('crew-row').filter({ hasText: 'E2E Putoff Rider' })).toBeVisible();
  const other = await browser.newContext();
  try {
    const crew = await other.newPage();
    await stubMetra(crew);
    await crew.clock.install({ time: EVENT_DAY });
    await login(crew, 'E2E Putoff Watcher', CREW);
    await crew.goto('/crew');
    await expect(crew.getByTestId('crew-row').filter({ hasText: 'E2E Putoff Watcher' })).toBeVisible();
    await expect(crew.getByTestId('crew-row').filter({ hasText: 'E2E Putoff Rider' })).toHaveCount(0);
    await expect(crew.getByTestId('crew-put-off')).toHaveCount(0);
  } finally { await other.close(); }
});

test('crew see plain names and the Conductor has no button on themselves', async ({ page, browser }) => {
  await sessionFor('E2E Plain Rider');
  await openBoard(page, 'E2E Plain Conductor');
  await expect(page.getByTestId('crew-row').filter({ hasText: 'E2E Plain Rider' }).getByTestId('crew-name-button')).toBeVisible();
  await expect(page.getByTestId('crew-row').filter({ hasText: 'E2E Plain Conductor' }).getByTestId('crew-name-button')).toHaveCount(0);
  const other = await browser.newContext();
  try {
    const crew = await other.newPage();
    await stubMetra(crew);
    await crew.clock.install({ time: EVENT_DAY });
    await login(crew, 'E2E Plain Rider', CREW);
    await crew.goto('/crew');
    await expect(crew.getByTestId('crew-row').filter({ hasText: 'E2E Plain Conductor' })).toBeVisible();
    await expect(crew.getByTestId('crew-name-button')).toHaveCount(0);
  } finally { await other.close(); }
});

/** A Tab proof sent as `who` at `stop`: the same request the Tab makes. */
async function postDrink(who: { token: string; record: Record<string, unknown> }, stop: string, kind: string) {
  const form = new FormData();
  form.set('user', String(who.record.id));
  form.set('stop', stop);
  form.set('kind', 'image');
  form.set('taken_at', new Date().toISOString());
  form.set('drink_kind', kind);
  form.set('file', new Blob([PROOF_JPEG.buffer], { type: PROOF_JPEG.mimeType }), PROOF_JPEG.name);
  const res = await fetch(`${PB}/api/collections/media/records`, { method: 'POST', headers: { Authorization: who.token }, body: form });
  if (!res.ok) throw new Error(`Drink failed: ${res.status} ${await res.text()}`);
}

test("the board's Golden Spikes skip a trainspotter", async ({ page }) => {
  const big = await sessionFor('E2E Spotter Big');
  const small = await sessionFor('E2E Spotter Small');
  const ids = await openBoard(page, 'E2E Spotter Conductor');
  // Big reaches Big Boy first; Small ties, which never takes it.
  for (let i = 0; i < 3; i++) await postDrink(big, ids.firstStopId, 'beer');
  for (let i = 0; i < 3; i++) await postDrink(small, ids.firstStopId, 'beer');
  const bigRow = page.getByTestId('crew-row').filter({ hasText: 'E2E Spotter Big' });
  const smallRow = page.getByTestId('crew-row').filter({ hasText: 'E2E Spotter Small' });
  await expect(bigRow.getByTestId('spike-laurel')).toHaveAttribute('aria-label', /Big Boy/);
  // Small has a laurel too (Triple Header), just not Big Boy.
  await expect(smallRow.getByTestId('spike-laurel')).not.toHaveAttribute('aria-label', /Big Boy/);

  await setRole(String(big.record.id), 'trainspotter');
  await expect(page.getByTestId('crew-trainspotters').getByTestId('crew-row').filter({ hasText: 'E2E Spotter Big' })).toBeVisible();
  await expect(smallRow.getByTestId('spike-laurel')).toHaveAttribute('aria-label', /Big Boy/);
  await expect(bigRow.getByTestId('spike-laurel')).toHaveCount(0);

  // What they posted stays: the proof photo is still in Crew chat under their name.
  await page.goto('/live');
  await expect(page.getByTestId('crew-chat').locator('article').filter({ hasText: 'E2E Spotter Big' }).first()).toBeVisible();
});

test('a role save that fails shows inline', async ({ page }) => {
  const rider = await sessionFor('E2E Vanishing Rider');
  await openBoard(page, 'E2E Vanishing Conductor');
  await page.getByTestId('crew-row').filter({ hasText: 'E2E Vanishing Rider' }).getByTestId('crew-name-button').click();
  const del = await fetch(`${PB}/api/collections/users/records/${rider.record.id}`, { method: 'DELETE', headers: { Authorization: await superuserToken() } });
  expect(del.status).toBe(204);
  await page.getByTestId('role-option-trainspotter').check();
  await page.getByTestId('role-save').click();
  await expect(page.getByTestId('role-error')).toBeVisible();
  await expect(page.getByTestId('role-window')).toBeVisible();
});
