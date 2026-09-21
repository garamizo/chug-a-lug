import { expect, test } from '@playwright/test';
import { clearLockedCrawls, deleteStopDirect, latestAnchor, login, seedLockedCrawl } from './helpers';
import { copy } from '../../src/lib/labels';

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

  // The editor says up front that this is a live route, before anything is touched.
  await expect(page.getByTestId('live-route-warning')).toContainText('The Route');
  // The start time is fixed once the crew is riding it: no live control for it, even for the
  // Conductor (contrast the draft screen, which does show one).
  await expect(page.getByTestId('start-time')).toHaveCount(0);

  const save = page.getByTestId('save-plan');
  await expect(save).toBeDisabled();
  await expect(page.getByTestId('save-blockers')).toContainText('Set where the crew is');

  await page.getByTestId('set-here-1').click();
  await expect(save).toBeEnabled();
  await expect(page.getByTestId('save-blockers')).toBeHidden();

  await save.click();
  await page.getByTestId('bulletin-skip').click();
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
  await page.getByTestId('bulletin-skip').click();
  await expect(page).toHaveURL(new RegExp(`/plan/${seeded.itineraryId}$`));
  await crewPage.reload();
  await expect(crewPage.getByText('The Second Round')).toBeHidden();
});

test('Save is disabled while the staged plan is checked, not just when it is broken', async ({ page }) => {
  await openEditor(page, 'E2E Pending Conductor', ADMIN);
  await page.getByTestId('set-here-0').click();
  await expect(page.getByTestId('save-plan')).toBeEnabled();

  // Gate the next check so the in-flight window is observable rather than racing past it.
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/plan/preview', async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByTestId('set-here-1').click(); // a harmless second edit, still triggers a fresh check
  await expect(page.getByTestId('save-plan')).toBeDisabled();
  await expect(page.getByTestId('preview-status')).toContainText('Checking the route');
  release?.();
  await expect(page.getByTestId('save-plan')).toBeEnabled();
});

test('a 409 stale after someone else edits The Route survives a reload without resurrecting the old plan', async ({ page }) => {
  const seeded = await openEditor(page, 'E2E Stale Conductor', ADMIN);
  await page.getByTestId('set-here-0').click();
  await expect(page.getByTestId('save-plan')).toBeEnabled();

  // Someone else's edit lands while this editor is open — the exact situation the commit
  // endpoint's reconcile step exists to catch. Written directly so the app never sees it coming.
  await deleteStopDirect(seeded.secondStopId);
  await page.getByTestId('save-plan').click();
  await page.getByTestId('bulletin-skip').click();
  await expect(page.locator('.savebar').getByRole('alert')).toContainText('Reload and make the change again');

  // Reload, exactly as the message says to. A plan parked earlier in this session must not come
  // back — only a fresh plan, read from what the database actually holds now, is safe to show.
  await page.reload();
  await expect(page.getByText('Berwyn Beer Hall')).toBeHidden();
});

test('a failed preview warns but still allows the server to accept Save', async ({ page }) => {
  const seeded = await openEditor(page, 'E2E Preview Failure Conductor', ADMIN);
  await page.route('**/api/plan/preview', (route) => route.abort('failed'));
  await page.getByTestId('set-here-0').click();
  await expect(page.getByTestId('preview-status')).toContainText(copy.checkFailed);
  await expect(page.getByTestId('save-plan')).toBeEnabled();
  await page.getByTestId('save-plan').click();
  await page.getByTestId('bulletin-skip').click();
  await expect(page).toHaveURL(new RegExp(`/plan/${seeded.itineraryId}$`));
});

test('a transport failure shows No signal beside Save', async ({ page }) => {
  await openEditor(page, 'E2E Offline Save Conductor', ADMIN);
  await page.getByTestId('set-here-0').click();
  await expect(page.getByTestId('save-plan')).toBeEnabled();
  await page.route('**/api/plan/commit', (route) => route.abort('failed'));
  await page.getByTestId('save-plan').click();
  await page.getByTestId('bulletin-skip').click();
  await expect(page.locator('.savebar').getByRole('alert')).toHaveText(copy.noSignal);
  await expect(page.getByTestId('save-plan')).toBeEnabled();
});

test('edits made before adding a stop survive the trip to the venue picker', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  const seeded = await openEditor(page, 'E2E Roundtrip Conductor', ADMIN);

  // Change the plan first, the way anyone would: place the crew, then annul a bar.
  await page.getByTestId('set-here-0').click();
  await page.getByTestId('remove-1').click();
  await expect(page.getByText('The Second Round')).toBeHidden();

  // Now go and add a stop, the way a Conductor actually would: tap a station circle. That is the
  // one moment the editor parks the staged change (`stagedActions.add`, right before the `goto`);
  // parking happens nowhere else now, so the trip through the venue picker has to go through this
  // real control, not a bare `page.goto`, for the earlier edits to have anything to survive on.
  await page.getByTestId('station-dot-CUS').click();
  await expect(page).toHaveURL(new RegExp(`/plan/${seeded.itineraryId}/add\\?station=CUS&side=left&staged=1$`));
  await page.getByTestId('manual-name').fill('Prairie Path Tap');
  await page.getByTestId('manual-add').click();

  // Back in the editor: the new bar is there AND the earlier edits are still there.
  await expect(page).toHaveURL(new RegExp(`/plan/${seeded.itineraryId}/edit$`));
  await expect(page.getByText('Prairie Path Tap')).toBeVisible();
  await expect(page.getByText('The Second Round')).toBeHidden();
  await expect(page.getByTestId('save-plan')).toBeEnabled(); // the position survived too

  await page.getByTestId('save-plan').click();
  await page.getByTestId('bulletin-skip').click();
  await expect(page).toHaveURL(new RegExp(`/plan/${seeded.itineraryId}$`));
  await expect(page.getByText('Prairie Path Tap')).toBeVisible();
  await expect(page.getByText('The Second Round')).toBeHidden();
});
