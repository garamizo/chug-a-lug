import { expect, test } from '@playwright/test';
import { clearLockedCrawls, login, seedLockedCrawl } from './helpers';
test('live actions open the Tab and camera choices and share activity with the crew', async ({ page, browser }) => {
  await login(page, 'Chat Conductor', process.env.ADMIN_PASSWORD ?? 'admin-test-password');
  await clearLockedCrawls();
  await seedLockedCrawl({ ownerName: 'Chat Conductor', eventDate: '2026-12-26', startTime: '12:00', departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
  await page.goto('/live');
  await expect(page.getByTestId('current-stop')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next stops' })).toBeVisible();
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
    await login(other, 'Chat Crew', process.env.CREW_PASSWORD ?? 'crew-test-password');
    await other.goto('/live');
    await expect(other.getByTestId('action-bulletin')).toBeDisabled();
    await page.getByTestId('action-tab').click();
    await expect(page.getByTestId('tab-dialog')).toBeVisible();
    await page.getByTestId('drink-beer').click();
    await expect(other.getByTestId('crew-chat')).toContainText('Chat Conductor');
    await expect(other.getByTestId('crew-chat')).toContainText('Beer');
    await page.getByTestId('tab-undo').click();
    await expect(other.getByTestId('crew-chat')).not.toContainText('Beer');
    await page.getByTestId('close-tab').click();
    const picker = page.waitForEvent('filechooser');
    await page.getByTestId('action-photo').click();
    expect((await picker).isMultiple()).toBe(true);
    await expect(page.getByTestId('freight-camera')).toHaveAttribute('capture', 'environment');
    await page.getByTestId('action-bulletin').click();
    await page.getByTestId('bulletin-body').fill('Meet by the platform.');
    await page.getByTestId('bulletin-send').click();
    await expect(other.getByTestId('crew-chat')).toContainText('Meet by the platform.');
  } finally { await context.close(); }
});
