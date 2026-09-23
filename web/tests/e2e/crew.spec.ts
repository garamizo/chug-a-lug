import { expect, test } from '@playwright/test';
import { login } from './helpers';

const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';

test('the Crew Board lists everyone who has logged in', async ({ page }) => {
  await login(page, 'E2E Roster One', CREW);
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-crew').click();

  await expect(page).toHaveURL(/\/crew$/);
  await expect(page.getByTestId('crew-row')).toContainText(['E2E Roster One']);
  await expect(page.getByTestId('crew-row').first()).toContainText('0');
});

test('the open Crew Board follows new users, drinks, undo and acknowledgements', async ({ page, browser }) => {
  const { clearLockedCrawls, seedLockedCrawl } = await import('./helpers');
  const { copy } = await import('../../src/lib/labels');
  await login(page, 'E2E Roster Conductor', process.env.ADMIN_PASSWORD ?? 'admin-test-password');
  await clearLockedCrawls();
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
    await crew.getByTestId('action-tab').click();
    await crew.getByTestId('drink-beer').click();
    await expect(row.locator('.tab > span[title="Beer"]')).toContainText('1');
    await crew.getByTestId('tab-undo').click();
    await expect(row.locator('.tab > span[title="Beer"]')).toContainText('0');
    await crew.getByTestId('close-tab').click();
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
