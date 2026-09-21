import { expect, test } from '@playwright/test';
import { clearLockedCrawls, login, seedLockedCrawl } from './helpers';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';
const DATE = '2026-12-26';

test('a plan change drafts a Bulletin the crew has to tap away', async ({ page, context }) => {
  page.on('dialog', (d) => d.accept());
  await login(page, 'E2E Bulletin Conductor', ADMIN);
  await clearLockedCrawls();
  const seeded = await seedLockedCrawl({
    ownerName: 'E2E Bulletin Conductor', eventDate: DATE, startTime: '12:00',
    departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z', extraVenueAtFirstStation: true
  });

  await page.goto(`/plan/${seeded.itineraryId}/edit`);
  await page.getByTestId('set-here-0').click();
  await page.getByTestId('remove-1').click();
  await page.getByTestId('save-plan').click();

  // The sheet arrives pre-filled with what changed; the Conductor sends it as it stands.
  const sheet = page.getByTestId('bulletin-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('bulletin-body')).toHaveValue(/The Second Round is annulled\./);
  await sheet.getByTestId('bulletin-send').click();
  await expect(page).toHaveURL(new RegExp(`/plan/${seeded.itineraryId}$`));

  // A second phone, logged in as Crew: its own browser context, so its cookie-based session
  // cannot inherit the Conductor's — `context.newPage()` alone would share that cookie jar and
  // land the "crew" tab already signed in as the Conductor (see liveEdit.spec.ts).
  const crewContext = await context.browser()!.newContext();
  const crewPage = await crewContext.newPage();
  await login(crewPage, 'E2E Bulletin Crew', CREW);
  await crewPage.goto('/plan');
  const pinned = crewPage.getByTestId('pinned-bulletin');
  await expect(pinned).toContainText('The Second Round is annulled.');
  await pinned.getByTestId('bulletin-ack').click();
  await expect(pinned).toBeHidden();

  // Acknowledged, it is still on the record.
  await crewPage.goto('/notifications');
  await expect(crewPage.getByTestId('bulletin-list')).toContainText('The Second Round is annulled.');
});

test('the Conductor can skip the Bulletin and still save', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await login(page, 'E2E Quiet Conductor', ADMIN);
  await clearLockedCrawls();
  const seeded = await seedLockedCrawl({
    ownerName: 'E2E Quiet Conductor', eventDate: DATE, startTime: '12:00',
    departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z'
  });

  await page.goto(`/plan/${seeded.itineraryId}/edit`);
  await page.getByTestId('set-here-0').click();
  await page.getByTestId('save-plan').click();
  await page.getByTestId('bulletin-skip').click();

  await expect(page).toHaveURL(new RegExp(`/plan/${seeded.itineraryId}$`));
  await page.goto('/plan');
  await expect(page.getByTestId('pinned-bulletin')).toHaveCount(0);
});

test('the Conductor can post a Bulletin without changing the plan', async ({ page }) => {
  await login(page, 'E2E Plain Conductor', ADMIN);
  await clearLockedCrawls();
  await seedLockedCrawl({
    ownerName: 'E2E Plain Conductor', eventDate: DATE, startTime: '12:00',
    departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z'
  });

  await page.goto('/plan');
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-bulletin').click();
  await page.getByTestId('bulletin-body').fill('Meet under the clock at Union Station.');
  await page.getByTestId('bulletin-send').click();

  await expect(page.getByTestId('pinned-bulletin')).toContainText('Meet under the clock');
});
