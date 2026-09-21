import { expect, test } from '@playwright/test';
import { clearLockedCrawls, latestAnchor, login, seedLockedCrawl } from './helpers';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';
const DATE = '2026-12-26';

async function openEditor(page: import('@playwright/test').Page, name: string, password: string) {
  await login(page, name, password);
  await clearLockedCrawls();
  const seeded = await seedLockedCrawl({
    ownerName: name, eventDate: DATE, startTime: '12:00',
    departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z',
    extraVenueAtFirstStation: true
  });
  await page.goto(`/plan/${seeded.itineraryId}/edit`);
  return seeded;
}

test('Save waits until the Conductor says where the crew is', async ({ page }) => {
  const seeded = await openEditor(page, 'E2E Editor Conductor', ADMIN);

  const save = page.getByTestId('save-plan');
  await expect(save).toBeDisabled();
  await expect(page.getByTestId('save-blockers')).toContainText('Set where the crew is');

  await page.getByTestId('set-here-1').click();
  await expect(save).toBeEnabled();
  await expect(page.getByTestId('save-blockers')).toBeHidden();

  await save.click();
  await expect(page).toHaveURL(new RegExp(`/plan/${seeded.itineraryId}$`));

  const anchor = await latestAnchor();
  expect(anchor?.stop).toBe(seeded.middleStopId);
});

test('a staged change reaches the crew only when it is saved', async ({ page, context }) => {
  page.on('dialog', (d) => d.accept());
  const seeded = await openEditor(page, 'E2E Staging Conductor', ADMIN);
  await page.getByTestId('set-here-0').click();
  await page.getByTestId('remove-1').click(); // annul the second bar at La Grange
  // Let the staged edit settle on the Conductor's own screen before checking anyone else's.
  await expect(page.getByText('The Second Round')).toBeHidden();

  // A second phone, logged in as Crew: its own browser context, so its cookie-based session
  // cannot inherit the Conductor's — `context.newPage()` alone would share that cookie jar and
  // land the "crew" tab already signed in as the Conductor.
  const crewContext = await context.browser()!.newContext();
  const crewPage = await crewContext.newPage();
  await login(crewPage, 'E2E Staging Crew', CREW);
  await crewPage.goto(`/plan/${seeded.itineraryId}`);
  await expect(crewPage.getByText('The Second Round')).toBeVisible();

  await page.getByTestId('save-plan').click();
  await expect(page).toHaveURL(new RegExp(`/plan/${seeded.itineraryId}$`));
  await crewPage.reload();
  await expect(crewPage.getByText('The Second Round')).toBeHidden();
});

test('the editor says the route is live before anything is touched', async ({ page }) => {
  await openEditor(page, 'E2E Warned Conductor', ADMIN);
  await expect(page.getByTestId('live-route-warning')).toContainText('The Route');
});

test('edits made before adding a stop survive the trip to the venue picker', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  const seeded = await openEditor(page, 'E2E Roundtrip Conductor', ADMIN);

  // Change the plan first, the way anyone would: place the crew, then annul a bar.
  await page.getByTestId('set-here-0').click();
  await page.getByTestId('remove-1').click();
  await expect(page.getByText('The Second Round')).toBeHidden();

  // Now go and add a stop, which leaves the editor entirely. Overpass is unreachable in the e2e
  // environment, so the manual entry form is the reliable way to pick a venue.
  await page.goto(`/plan/${seeded.itineraryId}/add?station=CUS&side=left&staged=1`);
  await page.getByTestId('manual-name').fill('Prairie Path Tap');
  await page.getByTestId('manual-add').click();

  // Back in the editor: the new bar is there AND the earlier edits are still there.
  await expect(page).toHaveURL(new RegExp(`/plan/${seeded.itineraryId}/edit$`));
  await expect(page.getByText('Prairie Path Tap')).toBeVisible();
  await expect(page.getByText('The Second Round')).toBeHidden();
  await expect(page.getByTestId('save-plan')).toBeEnabled(); // the position survived too

  await page.getByTestId('save-plan').click();
  await expect(page).toHaveURL(new RegExp(`/plan/${seeded.itineraryId}$`));
  await expect(page.getByText('Prairie Path Tap')).toBeVisible();
  await expect(page.getByText('The Second Round')).toBeHidden();
});
