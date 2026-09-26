import { expect, test } from '@playwright/test';
import { PB, clearLockedCrawls, login, seedLockedCrawl, superuserToken } from './helpers';
import { copy } from '../../src/lib/labels';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
// A 1×1 PNG: enough for PocketBase to store and thumbnail.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function attachPhotoPlace(stopId: string) {
  const token = await superuserToken();
  const form = new FormData();
  form.set('ref', `google:e2e-${stopId}`); form.set('source', 'google'); form.set('name', 'The Whistle Stop');
  form.append('photos', new Blob([PNG], { type: 'image/png' }), 'front.png');
  const place = await fetch(`${PB}/api/collections/places/records`, { method: 'POST', headers: { Authorization: token }, body: form });
  if (!place.ok) throw new Error(`Create place failed: ${place.status} ${await place.text()}`);
  const { id } = await place.json();
  const res = await fetch(`${PB}/api/collections/stops/records/${stopId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: token }, body: JSON.stringify({ place: id })
  });
  if (!res.ok) throw new Error(`Attach place failed: ${res.status} ${await res.text()}`);
}

test('stop cards show the venue’s photo while planning and editing', async ({ page }) => {
  await login(page, 'E2E Photo Planner', ADMIN);
  await clearLockedCrawls();
  const seeded = await seedLockedCrawl({ ownerName: 'E2E Photo Planner', eventDate: '2026-12-26', startTime: '12:00', departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z' });
  await attachPhotoPlace(seeded.firstStopId);

  await page.goto(`/plan/${seeded.itineraryId}`);
  await expect(page.getByTestId('stop-photo-0')).toHaveAttribute('src', /thumb=400x300/);
  await expect(page.getByTestId('stop-photo-1')).toHaveCount(0);
  await page.goto(`/plan/${seeded.itineraryId}/edit`);
  await expect(page.getByTestId('stop-photo-0')).toBeVisible();
});

test('return links are a back arrow and editing is a pen, both named for screen readers', async ({ page }) => {
  await login(page, 'E2E Icon Links', ADMIN);
  await clearLockedCrawls();
  const seeded = await seedLockedCrawl({ ownerName: 'E2E Icon Links', eventDate: '2026-12-26', startTime: '12:00', departAt: '2026-12-26T20:34:00.000Z', arriveAt: '2026-12-26T20:49:00.000Z' });
  await page.goto(`/plan/${seeded.itineraryId}`);
  const back = page.getByRole('link', { name: copy.backToPlanner });
  await expect(back).toHaveText('');
  await expect(back.locator('svg')).toBeVisible();
  const edit = page.getByRole('link', { name: copy.editDraft });
  await expect(edit).toHaveText('');
  await expect(edit.locator('svg')).toBeVisible();
  await edit.click();
  await expect(page).toHaveURL(new RegExp(`/plan/${seeded.itineraryId}/edit$`));
  await page.getByRole('link', { name: copy.doneEditing }).click();
  await expect(page).toHaveURL(new RegExp(`/plan/${seeded.itineraryId}$`));
  await expect(page.getByText(copy.backToPlanner)).toHaveCount(0);
});

test('the Bulletin composer closes on a tap outside, Escape, or going to another screen', async ({ page }) => {
  await login(page, 'E2E Composer', ADMIN);
  const open = async () => {
    await page.getByTestId('menu').click();
    await page.getByTestId('menu-bulletin').click();
    await expect(page.getByTestId('bulletin-sheet')).toBeVisible();
  };
  await page.goto('/');
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-plan').click();
  await expect(page).toHaveURL(/\/plan$/);
  await open();
  await page.getByTestId('bulletin-scrim').click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId('bulletin-sheet')).toBeHidden();
  await open();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('bulletin-sheet')).toBeHidden();
  await open();
  // Back is a client-side navigation here, the same as leaving through any other control.
  await page.evaluate(() => history.back());
  await expect(page).not.toHaveURL(/\/plan$/);
  await expect(page.getByTestId('bulletin-sheet')).toBeHidden();
});
