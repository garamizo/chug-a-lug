import { expect, test } from '@playwright/test';
import { clearRoutes, login, openTab, PB, seedLockedCrawl, sessionFor, tapDrink } from './helpers';

const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';

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
